import Dexie, { type IndexableType, type Table, type Transaction } from "dexie";
import type { CatalogEntry } from "../content/schema";
import { normalize, unitKey, wordKey } from "../domain/refs";
import {
  defaultSettings,
  type Asset,
  type Course,
  type InstalledPackage,
  type LearningState,
  type Lesson,
  type LessonItem,
  type MediaRef,
  type Phrase,
  type ReviewEvent,
  type Session,
  type Settings,
  type Word,
} from "../domain/types";
import type { BaseSkillRow, BaseSummaryRow, StashRow, SyncVersionRow } from "../sync/types";
import type { BlockProgress, StoredModule } from "../domain/types";
import { launchProfile } from "./profile";

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

/** Запись каталога в базе: `position` — её индекс в файле каталога, ключ `id` этот порядок теряет. */
export type StoredCatalogEntry = CatalogEntry & { position?: number };

export class AppDatabase extends Dexie {
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
  /** Модули программы из каталога — кеш, как и каталог уроков. */
  modules!: Table<StoredModule, string>;
  /** Выполнение блоков уроков курса: ответы, самопроверка, текст письма. */
  blockProgress!: Table<BlockProgress, string>;
  constructor(name: string) {
    super(name);
    // Схема 9: база v8 обновляется одной миграцией; копий и баз ниже v8 у Τετράδιο не было.
    this.version(9)
      .stores({
        words: "id,greek,russian,key,greekKey,[sortKey+id],*tokens",
        phrases: "id",
        lessons: "id,courseId",
        lessonItems: "[lessonId+unitKey],unitKey,[lessonId+position]",
        courses: "id",
        assets: "id,kind",
        media: "id",
        packages: "lessonId",
        catalog: "id,courseId",
        cardStates: "unitKey,introducedAt,card.due,ref.kind",
        events: "id,unitKey,sessionId,localDate,type,createdAt,[unitKey+createdAt],[type+createdAt]",
        sessions: "id,planDate,status,[status+createdAt]",
        settings: "id",
        meta: "key",
        cardSkills: "unitKey",
        baseSummary: "id",
        syncVersions: "id,createdAt",
        cardStash: "unitKey",
        modules: "id,courseId,number",
        blockProgress: "key,lessonId",
        lessonWords: null,
        states: null,
        baseSkills: null,
        syncStash: null,
        clozes: null,
      })
      .upgrade((tx) => migrateV9(tx));
  }
}
const launch = launchProfile();
/**
 * База владельца: своя на бота и Telegram-пользователя. Без владельца автооткрытие выключено: случайный запрос
 * падает с ошибкой, а не создаёт базу под предполагаемым владельцем.
 */
export const db = new AppDatabase(launch.kind === "blocked" ? "tetradio-unopened" : launch.databaseName);
if (launch.kind === "blocked") db.close({ disableAutoOpen: true });
export const SCHEMA_VERSION = 9;

/** WebKit (Telegram на macOS) отклоняет курсор по индексу пустой таблицы с UnknownError «Unable to open cursor». */
export async function distinctKeys<T>(table: Table<T>, index: string): Promise<IndexableType[]> {
  return (await table.count()) ? table.orderBy(index).uniqueKeys() : [];
}
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
  "blockProgress",
] as const;
/** Служебные ключи синхронизации в `meta`: идентификатор устройства и очередь не переносятся копией. */
export const SYNC_META_PREFIX = "sync:";

type Row = Record<string, unknown>;
const COURSE_FIELDS = ["id", "title", "exam", "updatedAt"];
const keep = (row: Row, fields: string[]) => {
  for (const key of Object.keys(row)) if (!fields.includes(key)) delete row[key];
};

/**
 * Из v8 в v9: уходят расписание, подписка, курс «Мои слова», правки и удаление карточек и связи, убранные
 * пользователем. Удалённые карточки уходят вместе с состоянием, навыками и местом в уроках; история ответов остаётся.
 * Незавершённое занятие старого формата закрывается: его ответы уже в истории.
 */
export async function migrateV9(tx: Pick<Transaction, "table">): Promise<void> {
  const gone: string[] = [];
  for (const [name, kind] of [
    ["words", "word"],
    ["phrases", "phrase"],
  ] as const) {
    const table = tx.table(name) as Table<Row, string>;
    const deleted = (await table.filter((row) => !!row.deletedAt).primaryKeys()) as string[];
    await table.bulkDelete(deleted);
    gone.push(...deleted.map((id) => unitKey({ kind, id })));
    await table.toCollection().modify((row) => {
      delete row.deletedAt;
      delete row.edited;
      delete row.provenance;
    });
  }
  if (gone.length) {
    for (const name of ["cardStates", "cardSkills", "cardStash"]) await tx.table(name).bulkDelete(gone);
    await tx.table("lessonItems").where("unitKey").anyOf(gone).delete();
  }
  await tx.table("courses").delete("my");
  await tx
    .table("courses")
    .toCollection()
    .modify((course: Row) => keep(course, COURSE_FIELDS));
  await tx
    .table("lessons")
    .toCollection()
    .modify((lesson: Row) => {
      lesson.completed = lesson.status === "completed";
      keep(lesson, ["id", "courseId", "title", "completed", "updatedAt"]);
    });
  await tx
    .table("packages")
    .toCollection()
    .modify((pack: Row) => {
      delete pack.removed;
    });
  await tx
    .table("sessions")
    .toCollection()
    .modify((session: Row) => {
      if (session.status === "active" && session.objectiveVersion !== 1) session.status = "ended";
      delete session.objectiveVersion;
    });
}

export async function ensureDefaults(database: AppDatabase = db): Promise<void> {
  if (!(await database.settings.get("settings"))) await database.settings.add(defaultSettings);
}
