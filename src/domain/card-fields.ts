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
export type CardKind = "word" | "phrase";
export const CARD_KINDS: readonly CardKind[] = ["word", "phrase"];
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
