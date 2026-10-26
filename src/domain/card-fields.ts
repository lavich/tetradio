// Общие поля карточек модели и схемы контента: схема берёт их отсюда, а не из `types.ts`, который ссылается на типы пакетов.
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
/** Спряжение глагола по лицам «я, ты, он, мы, вы, они»: настоящее и прошедшее; `third` — показывать только «он, она» и «они». */
export interface Paradigm {
  present: string[];
  past: string[];
  third?: true;
}
/** Группа настоящего времени: `B1` — как αγαπάω, `B2` — как μπορώ, `mid` — на -μαι, `other` — вне групп (είμαι). */
export const VERB_GROUPS = ["A", "B1", "B2", "mid", "other"] as const;
export type VerbGroup = (typeof VERB_GROUPS)[number];
export interface Segment {
  text: string;
  ipa: string;
  explanation: string;
  start: number;
}

/**
 * Виды планируемых карточек. Это набор поддерживаемых планировщиком карточек, а не закрытая
 * таксономия языкового знания. В отличие от `ExerciseType`, снятый вид отсюда уходит: перечисление
 * описывает то, что планировщик выдаёт сейчас, и лишний вид дал бы пустую группу на каждом экране.
 */
export type CardKind = LessonCardKind | "mistake";
export const CARD_KINDS: readonly CardKind[] = ["word", "phrase", "mistake"];
/** Виды карточек, которые поставляет контент урока. */
export type LessonCardKind = "word" | "phrase";
export const LESSON_CARD_KINDS: readonly LessonCardKind[] = ["word", "phrase"];
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
