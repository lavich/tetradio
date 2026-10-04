import { db, indexWord, type AppDatabase, type StoredCatalogEntry } from "../storage/db";
import { reportError } from "../reporting/reporting";
import { adoptStash, readPending } from "../sync/snapshot";
import {
  ContentError,
  parseCatalog,
  parsePackage,
  SHIPPED_FIELDS,
  type Catalog,
  type ContentPackage,
  type PackageMedia,
  type PackagePhrase,
  type PackageWord,
  type ShippedField,
} from "./schema";
import { unitKey, wordRef } from "../domain/refs";
import {
  DEFAULT_NEW_ITEMS_PER_DAY,
  type Asset,
  type Course,
  type InstalledPackage,
  type LearningRef,
  type Phrase,
  type Word,
} from "../domain/types";

export interface ContentFetcher {
  json(url: string): Promise<unknown>;
  blob(url: string): Promise<Blob>;
}

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const networkError = (what: string) =>
  new ContentError(
    offline()
      ? `Нет сети: ${what} ещё не загружен на это устройство.`
      : `Не удалось загрузить ${what}. Проверьте соединение и повторите.`,
    "network",
  );

/** Адрес файла контента относительно базы приложения: единый путь для загрузки пакетов и показа медиа. */
export const contentUrl = (url: string, base: string = import.meta.env.BASE_URL) =>
  `${base.endsWith("/") ? base : `${base}/`}${url}`;

export function httpFetcher(base: string = import.meta.env.BASE_URL): ContentFetcher {
  const load = async (url: string, what: string, init?: RequestInit) => {
    let response: Response;
    try {
      response = await fetch(contentUrl(url, base), init);
    } catch {
      throw networkError(what);
    }
    if (!response.ok) throw new ContentError(`Сервер ответил ${response.status} на запрос «${url}».`, "network");
    return response;
  };
  return {
    json: async (url) =>
      (
        await load(
          url,
          url.endsWith("catalog.json") ? "каталог уроков" : "пакет урока",
          url.endsWith("catalog.json") ? { cache: "no-cache" } : undefined,
        )
      )
        .json()
        .catch(() => {
          throw new ContentError("Файл контента повреждён: это не JSON.");
        }),
    blob: async (url) => (await load(url, "файл медиа")).blob(),
  };
}
export let fetcher: ContentFetcher = httpFetcher();
export const useFetcher = (next: ContentFetcher) => {
  fetcher = next;
};

export type CatalogPhase = "loading" | "ready" | "error";
let catalogState: CatalogPhase = "loading";
const catalogListeners = new Set<() => void>();
/**
 * Готовность каталога для экранов, которым важно отличить «ещё не загрузился» от «слова нет».
 * `loading` бывает только до первого успеха: фоновые обновления и их сбои показанное не прячут.
 */
export const catalogPhase = () => catalogState;
export const subscribeCatalog = (listener: () => void) => {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
};
const setCatalogPhase = (next: CatalogPhase) => {
  if (catalogState === next || (catalogState === "ready" && next !== "ready")) return;
  catalogState = next;
  catalogListeners.forEach((fn) => fn());
};
/** Только для тестов: вернуть каталог в состояние до первой загрузки. */
export const resetCatalogPhase = () => {
  catalogState = "loading";
};

export async function refreshCatalog(database: AppDatabase = db, source: ContentFetcher = fetcher): Promise<Catalog> {
  setCatalogPhase("loading"); // повтор после сбоя снова ждёт; после первого успеха фаза не меняется
  try {
    const catalog = parseCatalog(await source.json("content/catalog.json"));
    const tables = [database.catalog, database.modules, database.courses, database.lessons, database.meta];
    await database.transaction("rw", tables, async () => {
      await database.catalog.clear();
      await database.catalog.bulkAdd(catalog.lessons.map((entry, position) => ({ ...entry, position })));
      // Модули — кеш каталога, как и записи уроков: черновики видны описанием, их уроки не поставляются.
      await database.modules.clear();
      await database.modules.bulkAdd((catalog.modules ?? []).map((module, position) => ({ ...module, position })));
      await adoptCourses(catalog, database);
      await database.meta.put({ key: "catalogUpdatedAt", value: new Date().toISOString() });
    });
    setCatalogPhase("ready");
    return catalog;
  } catch (error) {
    setCatalogPhase("error");
    throw error;
  }
}

/** Первый в порядке каталога урок, в состав которого входит слово: одно слово бывает в нескольких уроках. */
export function firstLessonOf(entries: StoredCatalogEntry[], wordId: string): StoredCatalogEntry | null {
  const order = (entry: StoredCatalogEntry) => entry.position ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...entries].sort((a, b) => order(a) - order(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted.find((entry) => entry.wordIds?.includes(wordId)) ?? null;
}
export async function lessonOfWord(wordId: string, database: AppDatabase = db): Promise<StoredCatalogEntry | null> {
  return firstLessonOf(await database.catalog.toArray(), wordId);
}

export interface PackagePreview {
  entry: StoredCatalogEntry;
  pack: ContentPackage;
}
const previews = new Map<string, Promise<PackagePreview>>();
/**
 * Пакет урока для просмотра без установки: читается и проверяется так же, как при установке,
 * но ничего не пишет в базу. Удачный результат живёт в памяти вкладки, неудачный — нет, чтобы повтор сработал.
 */
export function previewPackage(
  lessonId: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<PackagePreview> {
  const task = (async () => {
    const entry = await database.catalog.get(lessonId);
    if (!entry) throw new ContentError("Этого урока нет в каталоге.");
    const key = `${lessonId}@${entry.version}`;
    const cached = previews.get(key);
    if (cached) return cached;
    const loading = (async () => {
      const pack = parsePackage(await source.json(entry.url));
      if (pack.id !== lessonId || pack.version !== entry.version)
        throw new ContentError("Пакет не соответствует записи каталога.");
      return { entry, pack };
    })();
    previews.set(key, loading);
    loading.catch(() => previews.delete(key));
    return loading;
  })();
  // Просмотр ничего не пишет, поэтому любой сбой, кроме отклонённого пакета, — это сбой загрузки.
  return task.catch((error: unknown) => {
    throw error instanceof ContentError ? error : networkError("пакет урока");
  });
}
/** Только для тестов: забыть прочитанные пакеты. */
export const resetPreviews = () => previews.clear();
export const previewMedia = (pack: ContentPackage): Map<string, PackageMedia> =>
  new Map(pack.media.map((item) => [item.id, item]));

/**
 * Каталог — единственное место, где известен курс урока, установленного прежней версией.
 * Название и экзамен курса берутся из каталога, дневной предел остаётся пользовательским.
 */
async function adoptCourses(catalog: Catalog, database: AppDatabase) {
  const now = new Date().toISOString();
  const courseOf = new Map(catalog.lessons.map((entry) => [entry.id, entry.courseId]));
  for (const lesson of await database.lessons.toArray()) {
    const courseId = courseOf.get(lesson.id);
    if (courseId && !lesson.courseId) await database.lessons.put({ ...lesson, courseId });
  }
  for (const item of catalog.courses) {
    const stored = await database.courses.get(item.id);
    const next: Course = {
      id: item.id,
      title: item.title,
      newItemsPerDay: stored?.newItemsPerDay ?? DEFAULT_NEW_ITEMS_PER_DAY,
      updatedAt: stored?.updatedAt ?? now,
    };
    if (item.exam) next.exam = item.exam;
    if (!stored || stored.title !== next.title || JSON.stringify(stored.exam) !== JSON.stringify(next.exam))
      await database.courses.put({ ...next, updatedAt: now });
  }
}

export interface InstallResult {
  status: "installed" | "updated" | "current";
  added: number;
  changed: number;
}

export type InstallPhase =
  { phase: "idle" } | { phase: "loading" } | { phase: "error"; message: string; kind: ContentError["kind"] };
const IDLE: InstallPhase = { phase: "idle" };
const phases = new Map<string, InstallPhase>();
const listeners = new Set<() => void>();
const setPhase = (lessonId: string, phase: InstallPhase) => {
  if (phase.phase === "idle") phases.delete(lessonId);
  else phases.set(lessonId, phase);
  listeners.forEach((fn) => fn());
};
/** Снимок для useSyncExternalStore должен быть стабильным по ссылке, иначе React зациклится. */
export const installPhase = (lessonId: string): InstallPhase => phases.get(lessonId) ?? IDLE;
export const subscribeInstall = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const inflight = new Map<string, Promise<InstallResult>>();
/** Ключ курса в общем хранилище состояний загрузки: идентификаторы курса и урока не пересекаются. */
const courseKey = (courseId: string) => `course:${courseId}`;
export const coursePhase = (courseId: string) => installPhase(courseKey(courseId));

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

/**
 * Фоновая догрузка начатых курсов: вызывается после обновления каталога при запуске. Курс начат, если у него есть
 * уроки на устройстве или пройденные на другом устройстве уроки ждут установки после синхронизации.
 */
export async function syncCourses(database: AppDatabase = db, source: ContentFetcher = fetcher): Promise<void> {
  const pending = (await database.catalog.bulkGet(Object.keys(await readPending(database)))).map(
    (entry) => entry?.courseId,
  );
  const started = new Set([...(await database.lessons.orderBy("courseId").uniqueKeys()).map(String), ...pending]);
  for (const id of await database.courses.toCollection().primaryKeys())
    if (started.has(id)) await installCourse(id, database, source);
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

const shipped = (word: PackageWord) =>
  Object.fromEntries(
    SHIPPED_FIELDS.filter((field) => word[field] !== undefined).map((field) => [field, word[field]]),
  ) as Pick<Word, ShippedField>;
/** Поставляемое слово в виде локальной записи: так его ставит установка и показывает просмотр без установки. */
export const wordFromPackage = (card: PackageWord, at: string): Word => ({
  ...shipped(card),
  id: card.id,
  createdAt: at,
  updatedAt: at,
  revision: card.revision,
});

/** Поставляемая фраза в виде локальной записи: происхождение остаётся в пакете. */
const phraseFromPackage = (card: PackagePhrase, at: string): Phrase => {
  const { revision, provenance: _provenance, ...rest } = card;
  return { ...rest, createdAt: at, updatedAt: at, revision };
};

/**
 * Карточки принадлежат пакету: новая ревизия перезаписывает поставляемые поля целиком, `createdAt` остаётся.
 * Карточка той же ревизии не перезаписывается.
 */
async function applyCards<
  P extends { id: string; revision: string },
  L extends { createdAt: string; revision?: string },
>(
  incoming: P[],
  table: { bulkGet(ids: string[]): Promise<(L | undefined)[]>; bulkPut(rows: L[]): Promise<unknown> },
  build: (card: P, at: string) => L,
  now: string,
  result: InstallResult,
) {
  const local = await table.bulkGet(incoming.map((card) => card.id));
  const rows: L[] = [];
  incoming.forEach((card, index) => {
    const stored = local[index];
    if (stored?.revision === card.revision) return;
    const row = build(card, now);
    if (stored) {
      result.changed++;
      rows.push({ ...row, createdAt: stored.createdAt });
    } else {
      result.added++;
      rows.push(row);
    }
  });
  await table.bulkPut(rows);
}

/**
 * Установка одной транзакцией: слова, фразы, связи, медиа и запись пакета. Ошибка в любой карточке
 * откатывает всё — корректная часть отдельно не устанавливается.
 */
export async function applyPackage(pack: ContentPackage, database: AppDatabase = db): Promise<InstallResult> {
  const now = new Date().toISOString();
  return database.transaction(
    "rw",
    [
      database.words,
      database.phrases,
      database.lessons,
      database.lessonItems,
      database.packages,
      database.media,
      database.cardStates,
      database.cardStash,
      database.meta,
    ],
    async () => {
      const installed = await database.packages.get(pack.id);
      // Курс дописывается и на неизменной версии: у базы, пережившей переход на курсы, его ещё нет.
      const known = await database.lessons.get(pack.id);
      if (known && !known.courseId && pack.courseId) await database.lessons.put({ ...known, courseId: pack.courseId });
      if (installed && installed.version === pack.version) return { status: "current", added: 0, changed: 0 };
      const result: InstallResult = { status: installed ? "updated" : "installed", added: 0, changed: 0 };
      if (!known)
        await database.lessons.add({
          id: pack.id,
          courseId: pack.courseId || undefined,
          title: pack.lesson.title,
          completed: false,
          updatedAt: now,
        });
      await applyCards(pack.words, database.words, (card, at) => indexWord(wordFromPackage(card, at)), now, result);
      await applyCards(pack.phrases, database.phrases, phraseFromPackage, now, result);
      const incoming = new Set<string>();
      for (const item of pack.items) {
        const ref: LearningRef = { kind: item.kind, id: item.id };
        const key = unitKey(ref);
        incoming.add(key);
        await database.lessonItems.put({ lessonId: pack.id, unitKey: key, ref, position: item.position });
      }
      /**
       * Состав урока принадлежит автору: карточка, исчезнувшая из новой версии, теряет связь с уроком.
       * Сама карточка, её прогресс и история остаются — она может жить в других уроках и в словаре.
       */
      for (const item of installed?.items ?? []) {
        const key = unitKey({ kind: item.kind, id: item.id });
        if (!incoming.has(key)) await database.lessonItems.delete([pack.id, key]);
      }
      await database.media.bulkPut(pack.media);
      const record: InstalledPackage = {
        lessonId: pack.id,
        courseId: pack.courseId || undefined,
        version: pack.version,
        schemaVersion: pack.schemaVersion,
        installedAt: now,
        words: pack.words,
        phrases: pack.phrases,
        items: pack.items,
        media: pack.media,
      };
      if (pack.lesson.kind) record.kind = pack.lesson.kind;
      if (pack.module) record.module = pack.module;
      if (pack.blocks) record.blocks = pack.blocks;
      if (pack.marks) record.marks = pack.marks;
      await database.packages.put(record);
      // Полученный из облака прогресс карточек этого пакета ждал установки: теперь он становится обычным состоянием.
      await adoptStash(database, pack.id, [
        ...pack.words.map((word) => wordRef(word.id)),
        ...pack.phrases.map((p) => ({ kind: "phrase" as const, id: p.id })),
      ]);
      return result;
    },
  );
}

const mediaInflight = new Map<string, Promise<Asset | null>>();
export function ensureAsset(
  id: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<Asset | null> {
  const running = mediaInflight.get(id);
  if (running) return running;
  const task = (async () => {
    try {
      const stored = await database.assets.get(id);
      if (stored) return stored;
      const ref = await database.media.get(id);
      if (!ref) return null;
      const blob = await source.blob(ref.url);
      if (blob.size !== ref.bytes) throw new ContentError(`Файл ${ref.url} повреждён: размер не совпадает.`);
      if (ref.mimeType === "image/svg+xml" && !(await blob.text()).includes("<svg"))
        throw new ContentError(`Файл ${ref.url} повреждён: это не SVG.`);
      const asset: Asset = {
        id,
        kind: ref.kind,
        blob: new Blob([blob], { type: ref.mimeType }),
        mimeType: ref.mimeType,
        source: ref.source,
        alt: ref.alt,
      };
      await database.assets.put(asset);
      return asset;
    } finally {
      mediaInflight.delete(id);
    }
  })();
  mediaInflight.set(id, task);
  return task;
}

export interface Readiness {
  installed: boolean;
  version: string | null;
  updateAvailable: boolean;
  required: number;
  present: number;
  missing: string[];
}
export async function lessonReadiness(lessonId: string, database: AppDatabase = db): Promise<Readiness> {
  const [pack, entry] = await Promise.all([database.packages.get(lessonId), database.catalog.get(lessonId)]);
  if (!pack) return { installed: false, version: null, updateAvailable: false, required: 0, present: 0, missing: [] };
  const required = pack.media.filter((item) => item.required);
  const present = await database.assets
    .where("id")
    .anyOf(required.map((item) => item.id))
    .primaryKeys();
  const have = new Set(present);
  return {
    installed: true,
    version: pack.version,
    updateAvailable: !!entry && entry.version !== pack.version,
    required: required.length,
    present: present.length,
    missing: required.filter((item) => !have.has(item.id)).map((item) => item.id),
  };
}
export async function downloadLessonMedia(
  lessonId: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<{ fetched: number; failed: string[] }> {
  const readiness = await lessonReadiness(lessonId, database);
  let fetched = 0;
  const failed: string[] = [];
  for (const id of readiness.missing) {
    try {
      if (await ensureAsset(id, database, source)) fetched++;
      else failed.push(id);
    } catch (error) {
      if (toContentError(error).kind === "storage") throw toContentError(error);
      failed.push(id);
    }
  }
  return { fetched, failed };
}
