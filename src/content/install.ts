import { rememberCourses } from "../storage/courses";
import { db, type AppDatabase, type StoredCatalogEntry } from "../storage/db";
import { reportError } from "../reporting/reporting";
import { applyPackage, type InstallResult } from "./apply";
import { fetcher, type ContentFetcher } from "./fetcher";
import { pruneMedia } from "./media";
import { catalogSettled, courseKey, setPhase } from "./phases";
import { paradigmsOf, ungroupedVerbsOf, voicedOf, ContentError, parsePackage } from "./schema";

const inflight = new Map<string, Promise<InstallResult>>();

export interface CourseInstallResult {
  installed: number;
  updated: number;
  failed: number;
}

/**
 * Порядок установки курса: сперва модуль, на котором пользователь (первый с непройденным уроком), затем остальные
 * в порядке программы, затем уроки вне модулей — по каталогу.
 */
export async function courseInstallOrder(courseId: string, database: AppDatabase = db): Promise<string[]> {
  const [entries, modules] = await Promise.all([
    database.catalog.where("courseId").equals(courseId).toArray(),
    database.modules.where("courseId").equals(courseId).sortBy("number"),
  ]);
  const programme = modules.map((module) => [
    ...module.lessonIds,
    ...(module.checkpointId ? [module.checkpointId] : []),
    ...(module.reviewIds ?? []),
  ]);
  const lessons = await database.lessons.bulkGet(programme.flat());
  const completed = new Set(lessons.filter((lesson) => lesson?.completed).map((lesson) => lesson!.id));
  const current = programme.findIndex((ids) => ids.some((id) => !completed.has(id)));
  const ordered = current < 0 ? programme : [programme[current], ...programme.filter((_, index) => index !== current)];
  const rank = new Map(ordered.flat().map((id, index) => [id, index]));
  const position = (entry: StoredCatalogEntry) => entry.position ?? Number.MAX_SAFE_INTEGER;
  return entries
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        position(a) - position(b),
    )
    .map((entry) => entry.id);
}

/**
 * Установка и обновление курса целиком. Уроки идут по одному: прерывание оставляет установленными
 * уже полученные, а ошибка не отменяет успешные — курс просто остаётся частично свежим.
 * Открытый урок не ждёт очереди: `installLesson` ставит его сразу, параллельно с фоновой установкой.
 */
export async function installCourse(
  courseId: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<CourseInstallResult> {
  const order = await courseInstallOrder(courseId, database);
  setPhase(courseKey(courseId), { phase: "loading" });
  const { result, failure } = await installInTurn(order, database, source);
  if (failure) setPhase(courseKey(courseId), { phase: "error", message: failure.message, kind: failure.kind });
  else setPhase(courseKey(courseId), { phase: "idle" });
  return result;
}

const PACKAGE_DOWNLOADS = 4;
/** Несколько загрузок сразу и одна уборка медиа в конце: уборка после каждого пакета перечитывала бы все. */
export async function installPackages(
  lessonIds: string[],
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<CourseInstallResult> {
  // Облачный прогресс скрытого курса просит уроки, которых в каталоге нет: они ждут возврата курса, а не падают ошибкой.
  const readListed = async () =>
    (await database.catalog.count()) > 0 ? await database.catalog.bulkGet(lessonIds) : null;
  let listed = await readListed();
  if (!listed || listed.some((entry) => !entry)) {
    await catalogSettled();
    listed = await readListed();
  }
  const wanted = listed ? lessonIds.filter((_, index) => listed![index]) : lessonIds;
  return (await installInTurn(wanted, database, source, PACKAGE_DOWNLOADS)).result;
}

async function installInTurn(lessonIds: string[], database: AppDatabase, source: ContentFetcher, parallel = 1) {
  const result: CourseInstallResult = { installed: 0, updated: 0, failed: 0 };
  let failure = null as ContentError | null;
  let next = 0;
  const worker = async () => {
    while (next < lessonIds.length) {
      const id = lessonIds[next++];
      try {
        const outcome = await installLesson(id, database, source, false);
        if (outcome.status === "installed") result.installed++;
        if (outcome.status === "updated") result.updated++;
      } catch (error) {
        result.failed++;
        failure = toContentError(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, lessonIds.length) }, worker));
  if (result.installed || result.updated) await pruneMedia(database).catch(() => undefined);
  return { result, failure };
}

/** `prune: false` — уборку медиа сделает пакетная установка один раз после всех уроков. */
export function installLesson(
  lessonId: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
  prune = true,
): Promise<InstallResult> {
  const running = inflight.get(lessonId);
  if (running) return running;
  const task = (async () => {
    let version: string | undefined;
    try {
      let entry = await database.catalog.get(lessonId);
      // Новое устройство: синхронизация просит уроки облачного прогресса, пока каталог ещё загружается.
      if (!entry) {
        await catalogSettled();
        entry = await database.catalog.get(lessonId);
      }
      if (!entry) throw new ContentError("Этого урока нет в каталоге.");
      version = entry.version;
      const installed = await database.packages.get(lessonId);
      // Сборка без поддержки текстов ставила пакет без них: та же версия с текстами в каталоге ставится заново.
      if (
        installed &&
        installed.version === entry.version &&
        (installed.readings?.length ?? 0) >= (entry.readings ?? 0) &&
        voicedOf(installed.readings) >= (entry.readingAudio ?? 0) &&
        paradigmsOf(installed.words) >= (entry.paradigms ?? 0) &&
        (installed.grouped || !ungroupedVerbsOf(installed))
      )
        return { status: "current", added: 0, changed: 0 } as InstallResult;
      const pack = parsePackage(await source.json(entry.url));
      if (pack.id !== lessonId || pack.version !== entry.version)
        throw new ContentError("Пакет не соответствует записи каталога.");
      const result = await applyPackage(pack, database);
      // Порядок курсов — порядок установки: курс запоминается первым уроком, не дожидаясь следующего каталога.
      if (result.status === "installed") await rememberCourses(database);
      if (prune) await pruneMedia(database).catch(() => undefined);
      return result;
    } catch (error) {
      const wrapped = toContentError(error);
      // Отсутствие сети — штатный случай офлайна; отчёт уходит об отклонённом или не сохранившемся пакете, без его содержимого.
      if (wrapped.kind !== "network")
        reportError(wrapped, {
          category: "content",
          extra: { kind: wrapped.kind, packageId: lessonId, packageVersion: version },
        });
      throw wrapped;
    } finally {
      inflight.delete(lessonId);
    }
  })();
  inflight.set(lessonId, task);
  return task;
}
export const toContentError = (error: unknown): ContentError => {
  if (error instanceof ContentError) return error;
  const name = (error as { name?: string })?.name ?? "";
  if (/Quota/i.test(name) || /quota/i.test(String((error as Error)?.message)))
    return new ContentError(
      "На устройстве недостаточно места: урок не сохранён, прежние данные не изменились.",
      "storage",
    );
  return new ContentError(error instanceof Error ? error.message : "Не удалось установить урок.", "storage");
};
