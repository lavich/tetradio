import type { Card, Grade } from "ts-fsrs";
import type { PackageItem, PackageMarks, PackageMedia, PackageWord, PackagePhrase } from "../content/schema";
import type { CatalogModule, CourseExam, LessonBlock, LessonKind } from "../content/course";
/**
 * Типы проверки. `listening` — узнавание написания на слух, `comprehension` — понимание значения на слух.
 * `recall` и `cloze` приложение больше не предлагает; в перечислении они нужны, чтобы читалась старая история.
 */
export type ExerciseType = "recall" | "recognition" | "assembly" | "spelling" | "listening" | "comprehension" | "cloze";
/**
 * Размеченный отрезок примера: `start` и `length` — в NFC-строке предложения, `russian` — перевод в этом контексте.
 * `wordId` — ссылка на карточку курса; у служебных слов её нет.
 */
export interface Gloss {
  start: number;
  length: number;
  russian: string;
  wordId?: string;
}
export interface Example {
  greek: string;
  russian: string;
  target: string;
  source?: string;
  glosses?: Gloss[];
}
export interface Segment {
  text: string;
  ipa: string;
  explanation: string;
  start: number;
}
/** `revision` — ревизия поставленного пакетом содержимого: по ней установка пропускает неизменные карточки. */
export interface Word {
  id: string;
  greek: string;
  russian: string;
  ipa: string;
  note?: string;
  /** Грамматические формы строкой (мн. ч., аорист и будущее, три рода) — поставляются курсом. */
  forms?: string;
  segments: Segment[];
  examples: Example[];
  imageAssetId?: string;
  audioAssetId?: string;
  verified: boolean;
  source?: string;
  createdAt: string;
  updatedAt: string;
  revision?: string;
}

/**
 * Виды планируемых карточек. Это набор поддерживаемых планировщиком карточек, а не закрытая
 * таксономия языкового знания. В отличие от `ExerciseType`, снятый вид отсюда уходит: перечисление
 * описывает то, что планировщик выдаёт сейчас, и лишний вид дал бы пустую группу на каждом экране.
 */
export type CardKind = "word" | "phrase";
export const CARD_KINDS: readonly CardKind[] = ["word", "phrase"];
/** Ссылка на планируемую карточку: одинаковые ID разных видов — разные единицы повторения. */
export interface LearningRef {
  kind: CardKind;
  id: string;
}
/** Происхождение подготовленного агентом материала; `request` обязателен для запрошенных преобразования и генерации. */
export type ProvenanceOperation = "verbatim" | "requested-transform" | "requested-generation";
export interface SourceRecord {
  sourceLabel: string;
  locator?: string;
  excerpt?: string;
  operation: ProvenanceOperation;
  request?: string;
}
/**
 * Происхождение карточки. `parts` — происхождение отдельных полей (например, `translation`), когда оно
 * отличается от основного текста: скажем, перевод взят из другого места материала. Вложенность одного
 * уровня: у части своих частей нет.
 */
export interface Provenance extends SourceRecord {
  parts?: Record<string, SourceRecord>;
}
/** Готовая языковая единица: приветствие, выражение, вопрос или предложение. Имена полей языково-нейтральны. */
export interface Phrase {
  id: string;
  text: string;
  translation?: string;
  usage?: string;
  note?: string;
  audioAssetId?: string;
  createdAt: string;
  updatedAt: string;
  revision?: string;
}
/** Содержимое карточки в сессии: снимок на момент создания занятия, обновление пакета его не меняет. */
export type SessionCard = { kind: "word"; word: Word } | { kind: "phrase"; phrase: Phrase };
/**
 * Снимок содержимого в событии ответа: у слова — прежняя форма, у фразы — текст и перевод, из снимка
 * сессии, а не из позднейшей версии пакета. Третий вариант читает снимки снятого вида из старой истории.
 */
export type CardSnapshot =
  { greek: string; russian: string } | { text: string; translation?: string } | { template: string; answer: string };
/** Курс: название и экзамен приходят из каталога, `newItemsPerDay` — дневной предел новых карточек пользователя. */
export interface Course {
  id: string;
  title: string;
  newItemsPerDay: number;
  /** Экзамен курса из каталога: общая дата и подтверждена ли местная. */
  exam?: CourseExam;
  updatedAt: string;
}
/** Урок меняется только завершением, поэтому `updatedAt` пройденного урока — момент, когда он пройден. */
export interface Lesson {
  id: string;
  courseId?: string;
  title: string;
  completed: boolean;
  updatedAt: string;
}
/** Членство карточки в уроке: уникальная пара урока и ключа карточки, порядок внутри урока. Удаление связи не трогает карточку и прогресс. */
export interface LessonItem {
  lessonId: string;
  unitKey: string;
  ref: LearningRef;
  position: number;
}
export interface Asset {
  id: string;
  kind: "image" | "audio";
  blob: Blob;
  mimeType: string;
  source: string;
  alt: string;
}
/** Описание медиа из пакета без самого файла: по нему ресурс догружается при использовании. */
export type MediaRef = PackageMedia;
/** Установленный пакет: версия, карточки и авторский состав урока (`items`) — по нему обновление снимает ушедшие связи. */
export interface InstalledPackage {
  lessonId: string;
  courseId?: string;
  version: string;
  schemaVersion: number;
  installedAt: string;
  words: PackageWord[];
  phrases: PackagePhrase[];
  items: PackageItem[];
  media: PackageMedia[];
  /** Урок курса (схема 4): вид, место в модуле и блоки. */
  kind?: LessonKind;
  module?: { id: string; position: number };
  blocks?: LessonBlock[];
  marks?: PackageMarks;
}
/** Модуль программы из каталога; `position` — порядок в каталоге. */
export type StoredModule = CatalogModule & { position: number };
/**
 * Выполнение блока урока курса. Ключ — `урок/блок`: идентификаторы стабильны между версиями пакета.
 * Самооценка письма и речи хранится как отмеченные критерии и не выдаётся за внешнюю оценку.
 */
export interface BlockProgress {
  key: string;
  lessonId: string;
  blockId: string;
  done: boolean;
  /** Результат заданий: верных пунктов из всех (для «почти» — как верные, отдельно в `almost`). */
  score?: { correct: number; almost: number; total: number };
  /** Ответы по идентификатору пункта — для показа при возврате к уроку. */
  answers?: Record<string, string>;
  /** Номера отмеченных критериев самопроверки. */
  checks?: number[];
  /** Текст письменного ответа. */
  text?: string;
  updatedAt: string;
}
/** Состояние повторений одной карточки; ключ — сериализованная пара вида и идентификатора. */
export interface LearningState {
  unitKey: string;
  ref: LearningRef;
  card: Card;
  introducedAt: string;
  version: number;
}
export interface ReviewEvent {
  id: string;
  sessionId: string;
  itemId: string;
  ref: LearningRef;
  unitKey: string;
  snapshot: CardSnapshot;
  type: ExerciseType;
  /** `preview` — досрочная подготовка к занятию прежних версий: остаётся в истории. */
  mode: "scheduled" | "practice" | "preview";
  rating: Grade;
  correct: boolean | null;
  answer: string;
  createdAt: string;
  localDate: string;
  responseTimeMs: number;
  before?: Card;
  after?: Card;
}
/** `skipped` — упражнение пропущено без оценки знания (например, аудио недоступно): события нет, позиция сдвигается. */
/** `lessonTitle` — урок новой карточки для подписи на экране знакомства. */
/** `mode` — `scheduled` очередное упражнение дня, `practice` ручная тренировка и дополнительная попытка. */
export interface SessionItem {
  id: string;
  ref: LearningRef;
  unitKey: string;
  card: SessionCard;
  type: ExerciseType;
  options: string[];
  isNew: boolean;
  mode: "scheduled" | "practice";
  expectedVersion: number;
  eventId?: string;
  retryOf?: string;
  skipped?: boolean;
  lessonTitle?: string;
}
export interface Session {
  id: string;
  createdAt: string;
  planDate: string;
  items: SessionItem[];
  index: number;
  status: "active" | "done" | "ended";
  activeTimeMs: number;
  introducedKeys?: string[];
}
/** `errorReports` — отправка отчётов о сбоях во внешний сервис; включена по умолчанию, в компактный снимок синхронизации не входит. */
export interface Settings {
  id: "settings";
  timezone: string;
  sessionSize: number;
  errorReports: boolean;
  autoSpeak: boolean;
}
export const defaultSettings: Settings = {
  id: "settings",
  timezone: "Asia/Nicosia",
  sessionSize: 20,
  errorReports: true,
  autoSpeak: true,
};
/** Предел новых карточек нового курса; сохранённый предел курса это значение не меняет. */
export const DEFAULT_NEW_ITEMS_PER_DAY = 12;
/** Запись настроек старой версии или из старой копии читается без миграции. */
export const fillSettings = (settings: Partial<Settings> | undefined): Settings => ({
  ...defaultSettings,
  ...settings,
});
/**
 * Полный снимок данных: используется только в тестах как источник для планировщика.
 * Экраны приложения читают ограниченные выборки, а не снимок. Словарные связи `links` и смешанные `items`
 * складываются: так прежние сценарии остаются словарными без переписывания.
 */
export interface Snapshot {
  words: Word[];
  phrases?: Phrase[];
  lessons: Lesson[];
  courses?: Course[];
  /** Модули программы: задают порядок пройденных уроков; без них — порядок массива `lessons`. */
  modules?: StoredModule[];
  links: { lessonId: string; wordId: string; position: number }[];
  items?: LessonItem[];
  states: LearningState[];
  events: ReviewEvent[];
  sessions: Session[];
  settings: Settings;
}
