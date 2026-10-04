import { db, type AppDatabase } from "../storage/db";
import { reportError } from "../reporting/reporting";
import { applyPackage, type InstallResult } from "./apply";
import { fetcher, type ContentFetcher } from "./fetcher";
import { courseKey, setPhase } from "./phases";
import { ContentError, parsePackage } from "./schema";

const inflight = new Map<string, Promise<InstallResult>>();

export interface CourseInstallResult {
  installed: number;
  updated: number;
  failed: number;
}

/**
 * Установка и обновление курса целиком. Уроки идут по одному: прерывание оставляет установленными
 * уже полученные, а ошибка не отменяет успешные — курс просто остаётся частично свежим.
 */
export async function installCourse(
  courseId: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<CourseInstallResult> {
  const entries = await database.catalog.where("courseId").equals(courseId).toArray();
  const result: CourseInstallResult = { installed: 0, updated: 0, failed: 0 };
  setPhase(courseKey(courseId), { phase: "loading" });
  let failure: ContentError | null = null;
  for (const entry of entries) {
    try {
      const outcome = await installLesson(entry.id, database, source);
      if (outcome.status === "installed") result.installed++;
      if (outcome.status === "updated") result.updated++;
    } catch (error) {
      result.failed++;
      failure = toContentError(error);
    }
  }
  if (failure) setPhase(courseKey(courseId), { phase: "error", message: failure.message, kind: failure.kind });
  else setPhase(courseKey(courseId), { phase: "idle" });
  return result;
}

export function installLesson(
  lessonId: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<InstallResult> {
  const running = inflight.get(lessonId);
  if (running) return running;
  const task = (async () => {
    setPhase(lessonId, { phase: "loading" });
    let version: string | undefined;
    try {
      const entry = await database.catalog.get(lessonId);
      if (!entry) throw new ContentError("Этого урока нет в каталоге.");
      version = entry.version;
      const installed = await database.packages.get(lessonId);
      if (installed && installed.version === entry.version)
        return { status: "current", added: 0, changed: 0 } as InstallResult;
      const pack = parsePackage(await source.json(entry.url));
      if (pack.id !== lessonId || pack.version !== entry.version)
        throw new ContentError("Пакет не соответствует записи каталога.");
      const result = await applyPackage(pack, database);
      setPhase(lessonId, { phase: "idle" });
      return result;
    } catch (error) {
      const wrapped = toContentError(error);
      setPhase(lessonId, { phase: "error", message: wrapped.message, kind: wrapped.kind });
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
