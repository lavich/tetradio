import type { Card, Grade } from "ts-fsrs";
import type { PackageItem, PackageMedia, PackageWord, PackagePhrase } from "../content/schema";
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
/**
 * `revision` — ревизия поставленного пакетом содержимого, `edited` — слово менялось локально после установки.
 * У слов пользователя обоих полей нет.
 */
export interface Word {
  id: string;
  greek: string;
  russian: string;
  ipa: string;
  note?: string;
  segments: Segment[];
  examples: Example[];
  imageAssetId?: string;
  audioAssetId?: string;
  verified: boolean;
  source?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  revision?: string;
  edited?: boolean;
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
  provenance: Provenance;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  revision?: string;
  edited?: boolean;
}
/** Содержимое карточки в сессии: снимок на момент создания занятия, обновление пакета его не меняет. */
export type SessionCard = { kind: "word"; word: Word } | { kind: "phrase"; phrase: Phrase };
/**
 * Снимок содержимого в событии ответа: у слова — прежняя форма, у фразы — текст и перевод, из снимка
 * сессии, а не из позднейшей версии пакета. Третий вариант читает снимки снятого вида из старой истории.
 */
export type CardSnapshot =
  { greek: string; russian: string } | { text: string; translation?: string } | { template: string; answer: string };
/** `dateSource` заполняется только в выборке: в базе дата либо своя (задана вручную), либо пустая (по расписанию). */
/** Курс своих наборов: он есть всегда, не обновляется из каталога и не исчезает вместе с ним. */
export const LOCAL_COURSE = "my";
/**
 * Курс: состав приходит из каталога, а подписка и время синхронизации принадлежат пользователю.
 * `newItemsPerDay` — дневной предел новых карточек любого вида; прежний предел слов перешёл в него с тем же числом.
 */
export interface Course {
  id: string;
  title: string;
  source?: string;
  language?: string;
  origin: "content" | "local";
  subscribed: boolean;
  schedule: Schedule;
  newItemsPerDay: number;
  syncedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface Lesson {
  id: string;
  courseId?: string;
  title: string;
  targetDate: string | null;
  status: "upcoming" | "completed";
  createdAt: string;
  updatedAt: string;
  dateSource?: "manual" | "schedule";
}
/** Прежняя связь слова с уроком: остаётся в тестовых снимках и старых копиях, в базе заменена `LessonItem`. */
export interface LessonWord {
  lessonId: string;
  wordId: string;
  position: number;
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
/**
 * Установленный пакет: версия, база поставленных карточек для слияния при обновлении, авторский состав урока
 * (`items`) и связи, которые пользователь убрал сам (ключи карточек), чтобы обновление их не восстановило.
 * По прежнему составу видно, какие связи поставил пакет: только их снимает обновление, убравшее карточку из урока.
 * `version:'legacy'` — контент установлен старой версией приложения, база карточек неизвестна.
 */
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
  removed: string[];
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
/** `lessonTitle`/`lessonPast` — урок новой карточки для подписи на экране знакомства. */
/** `mode` — `scheduled` очередное упражнение дня, `preview` досрочная подготовка к занятию, `practice` ручная тренировка и дополнительная попытка. */
export interface SessionItem {
  id: string;
  ref: LearningRef;
  unitKey: string;
  card: SessionCard;
  type: ExerciseType;
  options: string[];
  isNew: boolean;
  mode: "scheduled" | "practice" | "preview";
  expectedVersion: number;
  eventId?: string;
  retryOf?: string;
  skipped?: boolean;
  lessonTitle?: string;
  lessonPast?: boolean;
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
  objectiveVersion?: 1;
}
/** Дни недели по ISO: 1 — понедельник, 7 — воскресенье. */
export interface Schedule {
  startDate: string | null;
  weekdays: number[];
  /** Час занятия 0–23 в зоне пользователя: после него подготовка к уроку окончена. */
  lessonHour: number;
}
/** `errorReports` — отправка отчётов о сбоях во внешний сервис; включена по умолчанию, в компактный снимок синхронизации не входит. */
export interface Settings {
  id: "settings";
  timezone: string;
  sessionSize: number;
  errorReports: boolean;
  autoSpeak: boolean;
}
export const DEFAULT_LESSON_HOUR = 12;
export const defaultSchedule: Schedule = { startDate: null, weekdays: [], lessonHour: DEFAULT_LESSON_HOUR };
export const defaultSettings: Settings = {
  id: "settings",
  timezone: "Asia/Nicosia",
  sessionSize: 20,
  errorReports: true,
  autoSpeak: true,
};
/**
 * Предел новых карточек нового курса. Очередь ведёт только ближайшее занятие, поэтому окно подготовки
 * к уроку — промежуток между ним и предыдущим: набор из 35 карточек за три дня требует двенадцати в день.
 * Прежняя десятка не покрывала такой темп и упиралась в предупреждение о нехватке. Курс с уже сохранённым
 * пределом этого значения не видит: его меняет пользователь на экране курса.
 */
export const DEFAULT_NEW_ITEMS_PER_DAY = 12;
/** Запись настроек старой версии или из старой копии читается без миграции. */
export const fillSettings = (settings: Partial<Settings> | undefined): Settings => ({
  ...defaultSettings,
  ...settings,
});
/**
 * Расписание из базы, копии или снимка: час занятия появился позже остальных полей, поэтому
 * отсутствующее, дробное и выходящее за 0–23 значение читается как полдень.
 */
export const fillSchedule = (schedule: Partial<Schedule> | undefined): Schedule => {
  const hour = schedule?.lessonHour;
  return {
    ...defaultSchedule,
    ...schedule,
    lessonHour: Number.isInteger(hour) && hour! >= 0 && hour! <= 23 ? hour! : DEFAULT_LESSON_HOUR,
  };
};
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
  links: LessonWord[];
  items?: LessonItem[];
  states: LearningState[];
  events: ReviewEvent[];
  sessions: Session[];
  settings: Settings;
}
