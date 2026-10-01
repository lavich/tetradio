import type { SkillSummary, StatsSummary } from "../domain/skills";
import type { Card } from "ts-fsrs";
import type { LearningRef, Schedule } from "../domain/types";

/**
 * Версия облачного формата: другая версия не применяется и не перезаписывается старым клиентом.
 * Формат 3 — формат 2 плюс прогресс блоков уроков курса; формат 2 читается без блоков (локальные не трогаются).
 * Формат 2 — типизированные ссылки на карточки по видам; формат 1 читается как словарный. Коды снятых видов
 * и снятых типов проверки остаются занятыми: снимки старых клиентов их содержат.
 */
export const SNAPSHOT_FORMAT = 3;
/** Первый формат с прогрессом блоков курса: снимок более раннего формата блоков не несёт и их не заменяет. */
export const BLOCKS_SNAPSHOT_FORMAT = 3;
export const LEGACY_SNAPSHOT_FORMAT = 1;
export const SUPPORTED_SNAPSHOT_FORMATS = [1, 2, 3] as const;
/** Вектор счётчиков устройств: причинная база версии. */
export type Clock = Record<string, number>;

/** Карточка FSRS в JSON: даты — строки ISO, при применении оживляются в Date для индексов. */
export type SerializedCard = Omit<Card, "due" | "last_review"> & { due: string; last_review?: string };
export interface CompactState {
  ref: LearningRef;
  card: SerializedCard;
  introducedAt: string;
  version: number;
}
export interface CompactLesson {
  id: string;
  targetDate: string | null;
  status: "upcoming" | "completed";
  updatedAt: string;
}
export interface CompactSettings {
  timezone: string;
  sessionSize: number;
}
/**
 * Выполнение блока урока курса без текстов: введённые ответы (`answers`) и письменный текст (`text`) остаются
 * на устройстве. Завершение урока курса — `lessons[].status = completed`, его время — `lessons[].updatedAt`.
 */
export interface CompactBlock {
  lessonId: string;
  blockId: string;
  done: boolean;
  score?: { correct: number; almost: number; total: number };
  checks?: number[];
  updatedAt: string;
}
/** Темп курса переносится между устройствами: без него второе устройство считало бы дни иначе. */
export interface CompactCourse {
  id: string;
  subscribed: boolean;
  newItemsPerDay: number;
  schedule: Schedule;
}
/**
 * Компактный снимок стандартного прогресса: состояния FSRS и навыков поставляемых карточек, настройки,
 * даты/статусы стандартных уроков, выполнение блоков курса, требуемые пакеты и сводки статистики. Полная история, сессии,
 * пользовательские слова, тексты карточек, введённые ответы, описания целей и медиа в снимок не входят.
 */
export interface CompactSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  createdAt: string;
  settings: CompactSettings;
  courses: CompactCourse[];
  lessons: CompactLesson[];
  packages: string[];
  /** Прогресс блоков курса, по ключу `урок/блок`; включает блоки ещё не установленных уроков. */
  blocks: CompactBlock[];
  states: CompactState[];
  skills: { ref: LearningRef; skills: SkillSummary }[];
  stats: StatsSummary;
}

/** Опубликованная версия: идентификатор, устройство, причинная база и разрешённые ветви. */
export interface VersionMeta {
  id: string;
  device: string;
  clock: Clock;
  createdAt: string;
  format: number;
  parts: number;
  checksum: string;
  resolves: string[];
  /** Платформа устройства для отображения в конфликте. */ label?: string;
}
export interface StoredVersion {
  meta: VersionMeta;
  snapshot: CompactSnapshot;
}

/** Локально сохранённые альтернативы: конфликтные и отвергнутые версии до явного удаления. */
export interface SyncVersionRow {
  id: string;
  role: "conflict" | "rejected" | "restored";
  createdAt: string;
  meta: VersionMeta;
  snapshot: CompactSnapshot;
  note?: string;
}
/** База навыков карточки из последнего применённого или опубликованного снимка. */
export interface BaseSkillRow {
  unitKey: string;
  ref: LearningRef;
  skills: SkillSummary;
}
/** Сводка статистики базы и момент отсечки: локальные события после него складываются поверх. */
export interface BaseSummaryRow {
  id: "base";
  asOf: string;
  versionId: string;
  stats: StatsSummary;
}
/** Состояния карточек, пакет которых ещё не загружен: не теряются и не попадают в план до установки. */
export interface StashRow {
  unitKey: string;
  ref: LearningRef;
  state: CompactState;
}
