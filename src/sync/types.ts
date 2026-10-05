import type { SkillSummary, StatsSummary } from "../domain/skills";
import type { Card } from "ts-fsrs";
import type { LearningRef } from "../domain/types";

/**
 * Версия облачного формата: другая версия не применяется и не перезаписывается старым клиентом.
 * Формат 4 — формат 3 без полей расписания: урок передаёт только завершение, курс — дневной предел.
 * Формат 3 читается: статус урока становится завершением, расписание и даты отбрасываются.
 * Коды снятых видов и снятых типов проверки остаются занятыми: снимки старых клиентов их содержат.
 */
export const SNAPSHOT_FORMAT = 4;
export const SUPPORTED_SNAPSHOT_FORMATS = [3, 4] as const;
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
  completed: boolean;
  updatedAt: string;
}
/**
 * Выполнение блока курса без введённых ответов и текста: они остаются на устройстве.
 * Завершение урока курса передаётся в `lessons[]`.
 */
export interface CompactBlock {
  lessonId: string;
  blockId: string;
  done: boolean;
  score?: { correct: number; almost: number; total: number };
  checks?: number[];
  updatedAt: string;
}
/**
 * Компактный снимок прогресса: состояния FSRS и навыков карточек, пройденные уроки, выполнение блоков
 * курса, требуемые пакеты и сводки статистики. Полная история, сессии, тексты карточек, введённые ответы и медиа
 * в снимок не входят.
 */
export interface CompactSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  createdAt: string;
  lessons: CompactLesson[];
  packages: string[];
  /** Включает блоки ещё не установленных уроков. */
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
