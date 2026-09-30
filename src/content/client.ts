import { db, indexWord, type LexiDatabase, type StoredCatalogEntry } from "../storage/db";
import { reportError } from "../reporting/reporting";
import { adoptStash } from "../sync/snapshot";
import {
  ContentError,
  parseCatalog,
  parsePackage,
  PHRASE_FIELDS,
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
  defaultSchedule,
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

export async function refreshCatalog(database: LexiDatabase = db, source: ContentFetcher = fetcher): Promise<Catalog> {
  setCatalogPhase("loading"); // повтор после сбоя снова ждёт; после первого успеха фаза не меняется
  try {
    const catalog = parseCatalog(await source.json("content/catalog.json"));
    await database.transaction("rw", database.catalog, database.courses, database.lessons, database.meta, async () => {
      await database.catalog.clear();
      await database.catalog.bulkAdd(catalog.lessons.map((entry, position) => ({ ...entry, position })));
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
export async function lessonOfWord(wordId: string, database: LexiDatabase = db): Promise<StoredCatalogEntry | null> {
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
  database: LexiDatabase = db,
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
 * Шаг безвреден при повторе: он только дописывает недостающее и не трогает подписку, которую уже включили.
 */
async function adoptCourses(catalog: Catalog, database: LexiDatabase) {
  const now = new Date().toISOString();
  const courseOf = new Map(catalog.lessons.map((entry) => [entry.id, entry.courseId]));
  for (const lesson of await database.lessons.toArray()) {
    const courseId = courseOf.get(lesson.id);
    if (courseId && !lesson.courseId) await database.lessons.put({ ...lesson, courseId });
  }
  for (const item of catalog.courses) {
    const stored = await database.courses.get(item.id);
    const installed = await database.lessons.where("courseId").equals(item.id).count();
    const next: Course = {
      id: item.id,
      title: item.title,
      origin: stored?.origin ?? "content",
      subscribed: stored?.subscribed || installed > 0,
      schedule: stored?.schedule ?? defaultSchedule,
      newItemsPerDay: stored?.newItemsPerDay ?? DEFAULT_NEW_ITEMS_PER_DAY,
      createdAt: stored?.createdAt ?? now,
      updatedAt: stored?.updatedAt ?? now,
    };
    if (item.source) next.source = item.source;
    if (item.language) next.language = item.language;
    if (stored?.syncedAt) next.syncedAt = stored.syncedAt;
    if (
      !stored ||
      stored.title !== next.title ||
      stored.source !== next.source ||
      stored.language !== next.language ||
      stored.subscribed !== next.subscribed
    )
      await database.courses.put({ ...next, updatedAt: now });
  }
}

/** Конфликт обновления: карточка любого вида, её подпись для сообщения и поля, где локальное значение сохранено. */
export interface Conflict {
  ref: LearningRef;
  label: string;
  fields: string[];
}
export interface InstallResult {
  status: "installed" | "updated" | "current";
  added: number;
  changed: number;
  conflicts: Conflict[];
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

export async function setCourseSubscription(
  courseId: string,
  subscribed: boolean,
  database: LexiDatabase = db,
): Promise<void> {
  const stored = await database.courses.get(courseId);
  if (!stored || stored.subscribed === subscribed) return;
  await database.courses.put({ ...stored, subscribed, updatedAt: new Date().toISOString() });
}

export interface CourseInstallResult {
  installed: number;
  updated: number;
  failed: number;
  conflicts: Conflict[];
}

/**
 * Установка и обновление курса целиком. Уроки идут по одному: прерывание оставляет установленными
 * уже полученные, а ошибка не отменяет успешные — курс просто остаётся частично свежим.
 */
export async function installCourse(
  courseId: string,
  database: LexiDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<CourseInstallResult> {
  await setCourseSubscription(courseId, true, database);
  const entries = await database.catalog.where("courseId").equals(courseId).toArray();
  const result: CourseInstallResult = { installed: 0, updated: 0, failed: 0, conflicts: [] };
  setPhase(courseKey(courseId), { phase: "loading" });
  let failure: ContentError | null = null;
  for (const entry of entries) {
    try {
      const outcome = await installLesson(entry.id, database, source);
      if (outcome.status === "installed") result.installed++;
      if (outcome.status === "updated") result.updated++;
      result.conflicts.push(...outcome.conflicts);
    } catch (error) {
      result.failed++;
      failure = toContentError(error);
    }
  }
  if (failure) setPhase(courseKey(courseId), { phase: "error", message: failure.message, kind: failure.kind });
  else {
    setPhase(courseKey(courseId), { phase: "idle" });
    const stored = await database.courses.get(courseId);
    if (stored)
      await database.courses.put({
        ...stored,
        syncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
  }
  return result;
}

/** Фоновая догрузка подписанных курсов: вызывается после обновления каталога при запуске. */
export async function syncCourses(database: LexiDatabase = db, source: ContentFetcher = fetcher): Promise<void> {
  const subscribed = (await database.courses.toArray()).filter(
    (course) => course.origin === "content" && course.subscribed,
  );
  for (const course of subscribed) await installCourse(course.id, database, source);
}

export function installLesson(
  lessonId: string,
  database: LexiDatabase = db,
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
        return { status: "current", added: 0, changed: 0, conflicts: [] } as InstallResult;
      const pack = parsePackage(await source.json(entry.url));
      if (pack.id !== lessonId || pack.version !== entry.version)
        throw new ContentError("Пакет не соответствует записи каталога.");
      const result = await applyPackage(pack, database);
      if (pack.courseId) await setCourseSubscription(pack.courseId, true, database);
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

const canonical = (value: unknown) =>
  JSON.stringify(value === undefined ? null : value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
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

/**
 * Слияние обновления: нетронутая запись берёт новые значения целиком; отредактированная — по полям,
 * если известна база установленной версии; без базы локальный вариант сохраняется, отличия сообщаются.
 */
export function mergeWord(
  local: Word,
  base: PackageWord | undefined,
  next: PackageWord,
): { word: Word; conflicts: ShippedField[] } {
  return mergeFields(
    local as unknown as Record<string, unknown> & { edited?: boolean },
    base as Record<string, unknown> | undefined,
    next as unknown as Record<string, unknown>,
    SHIPPED_FIELDS,
  ) as unknown as { word: Word; conflicts: ShippedField[] };
}
function mergeFields<T extends Record<string, unknown>>(
  local: T & { edited?: boolean },
  base: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  fields: readonly string[],
): { word: T; conflicts: string[] } {
  const conflicts: string[] = [];
  const merged: Record<string, unknown> = { ...local };
  for (const field of fields) {
    const incoming = next[field];
    if (!local.edited) {
      assign(merged, field, incoming);
      continue;
    }
    if (base) {
      if (same(local[field], base[field])) assign(merged, field, incoming);
      else if (!same(incoming, base[field]) && !same(incoming, local[field])) conflicts.push(field);
    } else if (!same(local[field], incoming)) conflicts.push(field);
  }
  return { word: merged as T, conflicts };
}
function assign(target: Record<string, unknown>, field: string, value: unknown) {
  if (value === undefined) delete target[field];
  else target[field] = value;
}

/**
 * Общее слияние карточки любого вида: поставляемые поля берутся из пакета, локальные (`createdAt`, правки,
 * удаление) остаются. Возвращает конфликт, если локальная правка расходится с новой версией.
 */
async function applyCards<
  P extends { id: string; revision: string },
  L extends {
    id: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
    revision?: string;
    edited?: boolean;
  },
>(
  incoming: P[],
  base: Map<string, P>,
  fields: readonly string[],
  kind: LearningRef["kind"],
  labelOf: (card: P | L) => string,
  table: {
    get(id: string): Promise<L | undefined>;
    add(row: L): Promise<unknown>;
    put(row: L): Promise<unknown>;
    update(id: string, patch: Partial<L>): Promise<unknown>;
  },
  build: (card: P, now: string) => L,
  store: (row: L) => L,
  now: string,
  result: InstallResult,
) {
  const pickFields = (card: object) =>
    Object.fromEntries(
      fields
        .filter((field) => (card as Record<string, unknown>)[field] !== undefined)
        .map((field) => [field, (card as Record<string, unknown>)[field]]),
    );
  for (const card of incoming) {
    const local = await table.get(card.id);
    if (!local) {
      await table.add(store(build(card, now)));
      result.added++;
      continue;
    }
    if (local.revision === card.revision) continue;
    if (local.deletedAt) {
      const known = base.get(card.id);
      if (!same(pickFields(card), pickFields(known ?? { ...card, ...pickFields(local) })))
        result.conflicts.push({ ref: { kind, id: local.id }, label: labelOf(local), fields: ["deleted"] });
      await table.update(local.id, { revision: card.revision } as Partial<L>);
      continue;
    }
    const merged = mergeFields(
      local as unknown as Record<string, unknown> & { edited?: boolean },
      base.get(card.id) as Record<string, unknown> | undefined,
      card as unknown as Record<string, unknown>,
      fields,
    );
    if (merged.conflicts.length)
      result.conflicts.push({ ref: { kind, id: local.id }, label: labelOf(local), fields: merged.conflicts });
    const changed = !same(pickFields(merged.word), pickFields(local));
    if (changed) result.changed++;
    await table.put(
      store({ ...(merged.word as unknown as L), revision: card.revision, updatedAt: changed ? now : local.updatedAt }),
    );
  }
}

/**
 * Установка одной транзакцией: слова, фразы, связи, медиа и запись пакета. Ошибка в любой карточке
 * откатывает всё — корректная часть отдельно не устанавливается. Убранные пользователем связи не восстанавливаются.
 */
export async function applyPackage(pack: ContentPackage, database: LexiDatabase = db): Promise<InstallResult> {
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
      if (installed && installed.version === pack.version)
        return { status: "current", added: 0, changed: 0, conflicts: [] };
      const result: InstallResult = {
        status: installed ? "updated" : "installed",
        added: 0,
        changed: 0,
        conflicts: [],
      };
      if (!known)
        // Урок приходит без положения во времени: он предстоящий и без собственной даты, дальше им распоряжается расписание курса.
        await database.lessons.add({
          id: pack.id,
          courseId: pack.courseId || undefined,
          title: pack.lesson.title,
          targetDate: null,
          status: "upcoming",
          createdAt: now,
          updatedAt: now,
        });
      await applyCards<PackageWord, Word>(
        pack.words,
        new Map((installed?.words ?? []).map((word) => [word.id, word])),
        SHIPPED_FIELDS,
        "word",
        (card) => card.greek,
        database.words as never,
        wordFromPackage,
        indexWord,
        now,
        result,
      );
      await applyCards<PackagePhrase, Phrase>(
        pack.phrases,
        new Map((installed?.phrases ?? []).map((phrase) => [phrase.id, phrase])),
        PHRASE_FIELDS,
        "phrase",
        (card) => card.text,
        database.phrases,
        (card, at) => {
          const { revision, ...rest } = card;
          return { ...rest, createdAt: at, updatedAt: at, revision };
        },
        (row) => row,
        now,
        result,
      );
      const removed = new Set(installed?.removed ?? []);
      const incoming = new Set<string>();
      for (const item of pack.items) {
        const ref: LearningRef = { kind: item.kind, id: item.id };
        const key = unitKey(ref);
        incoming.add(key);
        if (!removed.has(key))
          await database.lessonItems.put({ lessonId: pack.id, unitKey: key, ref, position: item.position });
      }
      /**
       * Состав урока принадлежит автору: карточка, исчезнувшая из новой версии, теряет связь с уроком.
       * Сама карточка, её прогресс и история остаются — она может жить в других уроках и в словаре.
       * Снимаются только связи прежнего авторского состава: добавленное пользователем в этот урок не трогается.
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
        removed: [...removed],
      };
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
  database: LexiDatabase = db,
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
export async function lessonReadiness(lessonId: string, database: LexiDatabase = db): Promise<Readiness> {
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
  database: LexiDatabase = db,
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
