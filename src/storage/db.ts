import Dexie, { type Table, type Transaction } from "dexie";
import type { CatalogEntry } from "../content/schema";
import { normalize, wordKey } from "../domain/import";
import { isUnitKey, unitKey, wordRef } from "../domain/refs";
import {
  defaultSchedule,
  defaultSettings,
  DEFAULT_NEW_ITEMS_PER_DAY,
  LOCAL_COURSE,
  type Asset,
  type Course,
  type InstalledPackage,
  type Schedule,
  type LearningState,
  type Lesson,
  type LessonItem,
  type LessonWord,
  type MediaRef,
  type Phrase,
  type ReviewEvent,
  type Session,
  type SessionItem,
  type Settings,
  type Word,
} from "../domain/types";
import type { BaseSkillRow, BaseSummaryRow, StashRow, SyncVersionRow } from "../sync/types";
import { currentProfile } from "./profile";

export interface MetaRow {
  key: string;
  value: string;
}
export interface IndexFields {
  key: string;
  greekKey: string;
  sortKey: string;
  tokens: string[];
}
export type StoredWord = Word & IndexFields;

/** Диакритика снимается и в индексе, и в запросе, поэтому «σπι» находит «σπίτι». */
export const fold = (text: string) => normalize(text).normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
const SEPARATORS = /[\s,;:/()«»"'.!?…—-]+/u;
export const searchTokens = (text: string) => [...new Set(fold(text).split(SEPARATORS).filter(Boolean))];
export function indexWord(word: Word): StoredWord {
  const greekKey = normalize(word.greek);
  return {
    ...word,
    key: wordKey(word.greek, word.russian),
    greekKey,
    sortKey: fold(word.greek),
    tokens: [...new Set([...searchTokens(word.greek), ...searchTokens(word.russian)])],
  };
}

/** Прежние словарные хранилища схемы ≤5: остаются пустыми площадками для старых копий, читаются только миграцией. */
export interface LegacyState {
  wordId: string;
  card: LearningState["card"];
  introducedAt: string;
  version: number;
}
export interface LegacyStash {
  wordId: string;
  state: { wordId: string; card: unknown; introducedAt: string; version: number };
}
export interface LegacySkill {
  wordId: string;
  skills: BaseSkillRow["skills"];
}

/** Запись каталога в базе: `position` — её индекс в файле каталога, ключ `id` этот порядок теряет. */
export type StoredCatalogEntry = CatalogEntry & { position?: number };

export class LexiDatabase extends Dexie {
  words!: Table<StoredWord, string>;
  phrases!: Table<Phrase, string>;
  lessons!: Table<Lesson, string>;
  lessonItems!: Table<LessonItem, [string, string]>;
  courses!: Table<Course, string>;
  assets!: Table<Asset, string>;
  media!: Table<MediaRef, string>;
  packages!: Table<InstalledPackage, string>;
  catalog!: Table<StoredCatalogEntry, string>;
  cardStates!: Table<LearningState, string>;
  events!: Table<ReviewEvent, string>;
  sessions!: Table<Session, string>;
  settings!: Table<Settings, string>;
  meta!: Table<MetaRow, string>;
  cardSkills!: Table<BaseSkillRow, string>;
  baseSummary!: Table<BaseSummaryRow, string>;
  syncVersions!: Table<SyncVersionRow, string>;
  cardStash!: Table<StashRow, string>;
  /** Хранилища до схемы 6 с первичным ключом `wordId`: после миграции пусты. */
  lessonWords!: Table<LessonWord, [string, string]>;
  states!: Table<LegacyState, string>;
  baseSkills!: Table<LegacySkill, string>;
  syncStash!: Table<LegacyStash, string>;
  /** Хранилище снятого вида карточек: после миграции пусто, читается только при восстановлении копии схемы ≤6. */
  clozes!: Table<{ id: string }, string>;
  constructor(name = "lexi") {
    super(name);
    this.version(1).stores({
      words: "id,greek,russian,deletedAt",
      lessons: "id,targetDate,status",
      assets: "id,kind",
      states: "wordId,introducedAt",
      events: "id,wordId,sessionId,localDate,type",
      sessions: "id,planDate,status",
      settings: "id",
      meta: "key",
    });
    this.version(2)
      .stores({
        words: "id,greek,russian,deletedAt,key,greekKey,[sortKey+id],*tokens",
        lessons: "id,targetDate,status",
        lessonWords: "[lessonId+wordId],wordId,[lessonId+position]",
        assets: "id,kind",
        media: "id",
        packages: "lessonId",
        catalog: "id",
        states: "wordId,introducedAt,card.due",
        events: "id,wordId,sessionId,localDate,type,[wordId+createdAt],[type+createdAt]",
        sessions: "id,planDate,status,[status+createdAt]",
        settings: "id",
        meta: "key",
      })
      .upgrade((tx) => migrateLegacy(tx));
    // Схема 3: база синхронизации, отложенные состояния и сохранённые альтернативы; индекс времени событий.
    this.version(3).stores({
      events: "id,wordId,sessionId,localDate,type,createdAt,[wordId+createdAt],[type+createdAt]",
      baseSkills: "wordId",
      baseSummary: "id",
      syncVersions: "id,createdAt",
      syncStash: "wordId",
    });
    // Схема 4: уроки собраны в курсы; подписка и время синхронизации курса — данные пользователя.
    this.version(4)
      .stores({
        courses: "id,origin",
        lessons: "id,targetDate,status,courseId",
        catalog: "id,courseId",
      })
      .upgrade((tx) => migrateCourses(tx));
    // Схема 5: темп принадлежит курсу — расписание и дневной предел переезжают из общих настроек.
    this.version(5).upgrade((tx) => migrateCourseTempo(tx));
    /**
     * Схема 6: карточки трёх видов. Первичный ключ словарных хранилищ нельзя сменить на месте, поэтому состояния,
     * связи, база навыков и отложенный прогресс копируются в новые хранилища с типизированным ключом; события и сессии
     * получают ссылку и снимок содержимого; предел слов курса становится пределом карточек. Прежние хранилища
     * остаются пустыми площадками для старых копий и удаляются отдельным шагом версионирования.
     */
    this.version(6)
      .stores({
        phrases: "id,deletedAt",
        clozes: "id,deletedAt",
        lessonItems: "[lessonId+unitKey],unitKey,[lessonId+position]",
        cardStates: "unitKey,introducedAt,card.due,ref.kind",
        events: "id,unitKey,sessionId,localDate,type,createdAt,[unitKey+createdAt],[type+createdAt]",
        cardSkills: "unitKey",
        cardStash: "unitKey",
      })
      .upgrade((tx) => migrateCards(tx));
    /**
     * Схема 7: вид карточек «заполни пропуск» снят. Ключи снятого вида уходят из связей уроков, состояний
     * повторений, навыков, отложенного облачного прогресса и элементов незавершённых сессий: иначе они висели бы
     * ссылками без карточек и попадали в счётчики урока. События ответов не трогаются — событие это запись
     * о том, что было. Само хранилище остаётся пустой площадкой для восстановления прежних копий.
     */
    this.version(7).upgrade((tx) => migrateDropCloze(tx));
  }
}
/** База текущего профиля: обычный браузер — `lexi`, Telegram — отдельная база на бота и пользователя. */
export const db = new LexiDatabase(currentProfile().databaseName);
export const SCHEMA_VERSION = 7;
/** Таблицы пользовательских данных: входят в полную копию. Каталог — кеш, а не данные пользователя; альтернативные версии облака — тоже. */
export const TABLES = [
  "words",
  "phrases",
  "lessons",
  "courses",
  "lessonItems",
  "assets",
  "media",
  "packages",
  "cardStates",
  "events",
  "sessions",
  "settings",
  "meta",
  "cardSkills",
  "baseSummary",
  "cardStash",
] as const;
/** Наборы обязательных таблиц прежних копий: копия старого файла не обязана знать новые таблицы. */
export const TABLES_V5 = [
  "words",
  "lessons",
  "courses",
  "lessonWords",
  "assets",
  "media",
  "packages",
  "states",
  "events",
  "sessions",
  "settings",
  "meta",
  "baseSkills",
  "baseSummary",
  "syncStash",
] as const;
export const TABLES_V3 = [
  "words",
  "lessons",
  "lessonWords",
  "assets",
  "media",
  "packages",
  "states",
  "events",
  "sessions",
  "settings",
  "meta",
  "baseSkills",
  "baseSummary",
  "syncStash",
] as const;
export const TABLES_V2 = [
  "words",
  "lessons",
  "lessonWords",
  "assets",
  "media",
  "packages",
  "states",
  "events",
  "sessions",
  "settings",
  "meta",
] as const;
export const LEGACY_TABLES = [
  "words",
  "lessons",
  "assets",
  "states",
  "events",
  "sessions",
  "settings",
  "meta",
] as const;
/** Снятые хранилища: пусты после миграции, в копию не входят, читаются при восстановлении старых копий. */
export const LEGACY_STORES = ["lessonWords", "states", "baseSkills", "syncStash", "clozes"] as const;
export { LOCAL_COURSE } from "../domain/types";
export const SEED_LESSON = /^lesson-1-[1-4]$/,
  SEED_WORD = /^w1[1-4]-\d{2}$/;
/** Стандартное слово поставлено пакетом (есть ревизия) либо исходным набором старой версии. */
export const isStandardWord = (word: Pick<Word, "id" | "revision">) =>
  word.revision !== undefined || SEED_WORD.test(word.id);
/** Служебные ключи синхронизации в `meta`: идентификатор устройства и очередь не переносятся копией. */
export const SYNC_META_PREFIX = "sync:";
/** Дата создания исходных слов старой версии: слово с ней не редактировалось пользователем. */
export const LEGACY_CREATED = "2026-09-15T00:00:00.000Z";

const localCourse = (now: string): Course => ({
  id: LOCAL_COURSE,
  title: "Мои слова",
  origin: "local",
  subscribed: true,
  schedule: defaultSchedule,
  newItemsPerDay: DEFAULT_NEW_ITEMS_PER_DAY,
  createdAt: now,
  updatedAt: now,
});

/**
 * Переход на курсы без сети. Сохранённый пакет курса не знает, поэтому поставляемому уроку курс
 * проставит первое обновление каталога; здесь раскладываются только наборы пользователя.
 */
export async function migrateCourses(tx: Pick<Transaction, "table">): Promise<void> {
  const courses = tx.table("courses") as Table<Course, string>;
  const lessons = tx.table("lessons") as Table<Lesson, string>;
  const packages = tx.table("packages") as Table<InstalledPackage, string>;
  const now = new Date().toISOString();
  if (!(await courses.get(LOCAL_COURSE))) await courses.put(localCourse(now));
  for (const lesson of await lessons.toArray()) {
    if (lesson.courseId || (await packages.get(lesson.id))) continue;
    await lessons.put({ ...lesson, courseId: LOCAL_COURSE });
  }
}

/**
 * Темп переезжает в курс. Общее расписание и предел копируются каждому курсу, поэтому
 * сразу после перехода даты уроков и дневная норма остаются прежними, а дальше их можно развести.
 * Запись настроек без этих полей уже переведена: курсы не трогаются.
 */
export async function migrateCourseTempo(tx: Pick<Transaction, "table">): Promise<void> {
  const settings = tx.table("settings") as Table<Record<string, unknown>, string>;
  const courses = tx.table("courses") as Table<Course & { newWordsPerDay?: number }, string>;
  const stored = await settings.get("settings");
  if (!stored || (stored.schedule === undefined && stored.newWordsPerDay === undefined)) return;
  const schedule = (stored.schedule as Schedule | undefined) ?? defaultSchedule;
  const perDay = (stored.newWordsPerDay as number | undefined) ?? DEFAULT_NEW_ITEMS_PER_DAY;
  // До этой версии своего темпа у курса быть не могло, поэтому общие значения переносятся без оглядки.
  for (const course of await courses.toArray()) {
    const { newWordsPerDay: _legacy, ...rest } = course;
    await courses.put({ ...rest, schedule, newItemsPerDay: perDay });
  }
  const { schedule: _schedule, newWordsPerDay: _perDay, ...rest } = stored;
  await settings.put(rest);
}

/**
 * Миграция старой схемы: массивы `wordIds` становятся связями с сохранением порядка, слова получают индексы,
 * а исходные уроки, установленные старой версией, отмечаются как установленные без известной базы.
 * Ничего не скачивает и не трогает прогресс, историю и удаления пользователя.
 */
export async function migrateLegacy(tx: Pick<Transaction, "table">): Promise<void> {
  const lessons = tx.table("lessons") as Table<Lesson & { wordIds?: string[] }, string>;
  const links = tx.table("lessonWords") as Table<LessonWord, [string, string]>;
  const words = tx.table("words") as Table<StoredWord, string>;
  const packages = tx.table("packages") as Table<InstalledPackage, string>;
  const meta = tx.table("meta") as Table<MetaRow, string>;
  const seeded = !!(await meta.get("seed"));
  const now = new Date().toISOString();
  for (const lesson of await lessons.toArray()) {
    const wordIds = lesson.wordIds;
    if (wordIds) {
      await links.bulkPut(wordIds.map((wordId, position) => ({ lessonId: lesson.id, wordId, position })));
      delete lesson.wordIds;
      await lessons.put(lesson);
    }
    if (seeded && SEED_LESSON.test(lesson.id) && !(await packages.get(lesson.id)))
      await packages.put({
        lessonId: lesson.id,
        version: "legacy",
        schemaVersion: 0,
        installedAt: now,
        words: [],
        phrases: [],
        items: [],
        media: [],
        removed: [],
      });
  }
  await words.toCollection().modify((word) => {
    Object.assign(word, indexWord(word));
    if (seeded && SEED_WORD.test(word.id) && word.edited === undefined) word.edited = word.updatedAt !== LEGACY_CREATED;
  });
  await meta.delete("seed");
}

type LegacyItem = Partial<SessionItem> & { wordId?: string; word?: Word };
type LegacySession = Omit<Session, "items"> & { items: LegacyItem[]; introducedWordIds?: string[] };
type LegacyEvent = Partial<ReviewEvent> & { wordId?: string };
/**
 * Переход к карточкам трёх видов без сети. Словарные записи копируются в хранилища с типизированным ключом
 * с теми же ID, датами FSRS, версиями и порядком; события и сессии получают ссылку и снимок содержимого;
 * прежние хранилища очищаются после копирования. Повторный запуск (восстановление копии) ничего не удваивает.
 */
export async function migrateCards(tx: Pick<Transaction, "table">): Promise<void> {
  const states = tx.table("states") as Table<LegacyState, string>;
  const cardStates = tx.table("cardStates") as Table<LearningState, string>;
  for (const state of await states.toArray()) {
    const ref = wordRef(state.wordId),
      key = unitKey(ref);
    if (!(await cardStates.get(key)))
      await cardStates.put({
        unitKey: key,
        ref,
        card: state.card,
        introducedAt: state.introducedAt,
        version: state.version,
      });
  }
  await states.clear();
  const links = tx.table("lessonWords") as Table<LessonWord, [string, string]>;
  const items = tx.table("lessonItems") as Table<LessonItem, [string, string]>;
  for (const link of await links.toArray()) {
    const ref = wordRef(link.wordId),
      key = unitKey(ref);
    if (!(await items.get([link.lessonId, key])))
      await items.put({ lessonId: link.lessonId, unitKey: key, ref, position: link.position });
  }
  await links.clear();
  const skills = tx.table("baseSkills") as Table<LegacySkill, string>;
  const cardSkills = tx.table("cardSkills") as Table<BaseSkillRow, string>;
  for (const row of await skills.toArray()) {
    const key = unitKey(wordRef(row.wordId));
    if (!(await cardSkills.get(key)))
      await cardSkills.put({ unitKey: key, ref: wordRef(row.wordId), skills: row.skills });
  }
  await skills.clear();
  const stash = tx.table("syncStash") as Table<LegacyStash, string>;
  const cardStash = tx.table("cardStash") as Table<StashRow, string>;
  for (const row of await stash.toArray()) {
    const ref = wordRef(row.wordId),
      key = unitKey(ref);
    const { wordId: _wordId, ...rest } = row.state;
    if (!(await cardStash.get(key)))
      await cardStash.put({
        unitKey: key,
        ref,
        state: {
          ref,
          card: rest.card as StashRow["state"]["card"],
          introducedAt: rest.introducedAt,
          version: rest.version,
        },
      });
  }
  await stash.clear();
  const events = tx.table("events") as Table<LegacyEvent, string>;
  await events.toCollection().modify((event) => {
    if (event.unitKey && event.ref) return;
    const ref = wordRef(event.wordId ?? "");
    event.ref = ref;
    event.unitKey = unitKey(ref);
    delete event.wordId;
  });
  const sessions = tx.table("sessions") as Table<LegacySession, string>;
  await sessions.toCollection().modify((session) => {
    session.items = session.items.map((item) => {
      if (item.ref && item.unitKey && item.card) return item;
      const ref = wordRef(item.wordId ?? "");
      const { wordId: _wordId, word, ...rest } = item;
      return { ...rest, ref, unitKey: unitKey(ref), card: { kind: "word" as const, word: word! } };
    });
    if (session.introducedWordIds) {
      session.introducedKeys = [
        ...new Set([...(session.introducedKeys ?? []), ...session.introducedWordIds.map((id) => unitKey(wordRef(id)))]),
      ];
      delete session.introducedWordIds;
    }
  });
  const packages = tx.table("packages") as Table<InstalledPackage, string>;
  await packages.toCollection().modify((pack) => {
    pack.phrases ??= [];
    // Прежняя запись не хранила состав: у словарного пакета это его слова, у установки старой версии он неизвестен.
    pack.items ??= pack.words.map((word, position) => ({ kind: "word" as const, id: word.id, position }));
    pack.removed = (pack.removed ?? []).map((key) => (isUnitKey(key) ? key : unitKey(wordRef(key))));
  });
  const courses = tx.table("courses") as Table<Course & { newWordsPerDay?: number }, string>;
  await courses.toCollection().modify((course) => {
    if (course.newItemsPerDay === undefined) course.newItemsPerDay = course.newWordsPerDay ?? DEFAULT_NEW_ITEMS_PER_DAY;
    delete course.newWordsPerDay;
  });
  // Сводки синхронизации хранят ключи карточек: словарные идентификаторы становятся ключами слов.
  const summary = tx.table("baseSummary") as Table<{ id: string; stats: LegacyStats }, string>;
  await summary.toCollection().modify((row) => {
    row.stats = migrateStats(row.stats);
  });
  const versions = tx.table("syncVersions") as Table<{ id: string; snapshot: LegacySnapshot }, string>;
  await versions.toCollection().modify((row) => {
    row.snapshot = migrateSnapshot(row.snapshot);
  });
}
type LegacyStats = {
  days: { date: string; answers: number; wordIds?: string[]; keys?: string[] }[];
  answeredWordIds?: string[];
  answeredKeys?: string[];
  [key: string]: unknown;
};
type LegacySnapshot = {
  states?: { wordId?: string; ref?: unknown; [key: string]: unknown }[];
  skills?: { wordId?: string; ref?: unknown; [key: string]: unknown }[];
  stats?: LegacyStats;
  courses?: { newWordsPerDay?: number; newItemsPerDay?: number; [key: string]: unknown }[];
  [key: string]: unknown;
};
const migrateStats = ({ answeredWordIds, answeredKeys, days, ...rest }: LegacyStats): LegacyStats => ({
  ...rest,
  days: (days ?? []).map(({ wordIds, keys, ...day }) => ({
    ...day,
    keys: keys ?? (wordIds ?? []).map((id) => unitKey(wordRef(id))),
  })),
  answeredKeys: answeredKeys ?? (answeredWordIds ?? []).map((id) => unitKey(wordRef(id))),
});
/** Ключ снятого вида: сериализованная пара начинается его именем. Сам вид из `CardKind` уже убран. */
const DROPPED_KIND = "cloze";
const isDroppedKey = (key: string) => key.startsWith(`["${DROPPED_KIND}",`);
const isDroppedRef = (ref: { kind: string } | undefined) => ref?.kind === DROPPED_KIND;
/**
 * Схема 7: ключи снятого вида уходят отовсюду, где они были ссылкой на карточку. События ответов не трогаются:
 * событие — запись о том, что было. Незавершённая сессия продолжается с ближайшего оставшегося задания;
 * сессия, состоявшая только из снятых заданий, завершается — её сохранённые ответы уже в истории.
 */
export async function migrateDropCloze(tx: Pick<Transaction, "table">): Promise<void> {
  const clozes = tx.table("clozes") as Table<{ id: string }, string>;
  await clozes.clear();
  const items = tx.table("lessonItems") as Table<LessonItem, [string, string]>;
  for (const item of await items.toArray())
    if (isDroppedRef(item.ref)) await items.delete([item.lessonId, item.unitKey]);
  for (const name of ["cardStates", "cardSkills", "cardStash"] as const) {
    const table = tx.table(name) as Table<{ unitKey: string }, string>;
    for (const key of (await table.toCollection().primaryKeys()) as string[])
      if (isDroppedKey(key)) await table.delete(key);
  }
  const sessions = tx.table("sessions") as Table<Session, string>;
  await sessions.toCollection().modify((session) => {
    const kept = session.items.filter((item) => !isDroppedRef(item.ref));
    if (kept.length === session.items.length) return;
    // Позиция считается по оставшимся заданиям, иначе занятие продолжилось бы не с того места.
    const answered = new Set(session.items.slice(0, session.index).map((item) => item.id));
    session.items = kept;
    session.index = Math.min(kept.filter((item) => answered.has(item.id)).length, kept.length);
    session.introducedKeys = (session.introducedKeys ?? []).filter((key) => !isDroppedKey(key));
    if (!kept.length) session.status = session.status === "active" ? "ended" : session.status;
  });
  const packages = tx.table("packages") as Table<InstalledPackage & { clozes?: unknown[] }, string>;
  await packages.toCollection().modify((pack) => {
    delete pack.clozes;
    pack.items = (pack.items ?? []).filter((item) => !isDroppedRef(item));
    pack.removed = (pack.removed ?? []).filter((key) => !isDroppedKey(key));
  });
}

/** Сохранённая альтернативная версия облака прежней формы читается как словарная; применяется она только через новое чтение облака. */
const migrateSnapshot = (snapshot: LegacySnapshot): LegacySnapshot => ({
  ...snapshot,
  states: (snapshot.states ?? []).map(({ wordId, ...rest }) =>
    rest.ref ? rest : { ...rest, ref: wordRef(wordId ?? "") },
  ),
  skills: (snapshot.skills ?? []).map(({ wordId, ...rest }) =>
    rest.ref ? rest : { ...rest, ref: wordRef(wordId ?? "") },
  ),
  stats: snapshot.stats ? migrateStats(snapshot.stats) : snapshot.stats,
  courses: (snapshot.courses ?? []).map(({ newWordsPerDay, ...rest }) => ({
    ...rest,
    newItemsPerDay: rest.newItemsPerDay ?? newWordsPerDay ?? DEFAULT_NEW_ITEMS_PER_DAY,
  })),
});

export async function ensureDefaults(database: LexiDatabase = db): Promise<void> {
  if (!(await database.settings.get("settings"))) await database.settings.add(defaultSettings);
  await ensureLocalCourse(database);
}
/** Курс своих наборов заводится и в новой базе, где миграция не выполнялась. */
export async function ensureLocalCourse(database: LexiDatabase = db): Promise<string> {
  if (!(await database.courses.get(LOCAL_COURSE))) await database.courses.put(localCourse(new Date().toISOString()));
  return LOCAL_COURSE;
}
