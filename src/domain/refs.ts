// Расширения `.ts` обязательны: этот модуль загружает и Node при сборке контента (`node content/build.ts`),
// а его резолвер требует точный путь. В остальном коде приложения расширения не пишутся.
import { normalize } from "./import.ts";
import {
  CARD_KINDS,
  type CardKind,
  type CardSnapshot,
  type LearningRef,
  type LessonItem,
  type LessonWord,
  type SessionCard,
} from "./types.ts";

export type { LearningRef } from "./types.ts";

/** Ключ единицы повторения: сериализованная пара, чтобы ID разных видов не сталкивались и разделитель внутри ID не ломал разбор. */
export const unitKey = (ref: LearningRef): string => JSON.stringify([ref.kind, ref.id]);
export const wordRef = (id: string): LearningRef => ({ kind: "word", id });
export const phraseRef = (id: string): LearningRef => ({ kind: "phrase", id });
export const wordKeyOf = (id: string) => unitKey(wordRef(id));
export const isCardKind = (value: unknown): value is CardKind =>
  typeof value === "string" && (CARD_KINDS as readonly string[]).includes(value);
/** Ключ старой словарной записи: голый ID слова без сериализации. */
export const isUnitKey = (value: string) => value.startsWith('["');

/** Пара вида и идентификатора из ключа: сам вид не проверяется. */
function splitUnitKey(key: string): [unknown, string] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    throw new Error(`Некорректный ключ карточки: ${key}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[1] !== "string")
    throw new Error(`Некорректный ключ карточки: ${key}`);
  return [parsed[0], parsed[1]];
}

/**
 * Ссылка из ключа или `null`, если вид карточки снят: такие ключи остались в истории ответов и в сводках,
 * и читатель решает сам, отбросить их или счесть ошибкой. Там, где ссылка обязана быть — `parseUnitKey`.
 */
export function tryParseUnitKey(key: string): LearningRef | null {
  const [kind, id] = splitUnitKey(key);
  return isCardKind(kind) ? { kind, id } : null;
}

export function parseUnitKey(key: string): LearningRef {
  const [kind, id] = splitUnitKey(key);
  if (!isCardKind(kind)) throw new Error(`Неизвестный вид карточки «${String(kind)}»`);
  return { kind, id };
}

/** Словарная связь прежнего вида — типизированная связь того же порядка. */
export const itemOfLink = (link: LessonWord): LessonItem => ({
  lessonId: link.lessonId,
  unitKey: wordKeyOf(link.wordId),
  ref: wordRef(link.wordId),
  position: link.position,
});

/** Ссылка на содержимое сессии и снимок для события ответа. */
export const refOfCard = (card: SessionCard): LearningRef =>
  card.kind === "word" ? wordRef(card.word.id) : phraseRef(card.phrase.id);
export const snapshotOf = (card: SessionCard): CardSnapshot =>
  card.kind === "word"
    ? { greek: card.word.greek, russian: card.word.russian }
    : { text: card.phrase.text, ...(card.phrase.translation ? { translation: card.phrase.translation } : {}) };
/** Поставленная пакетом карточка имеет ревизию; у пользовательских слов её нет. */
export const isShippedCard = (card: SessionCard) =>
  (card.kind === "word" ? card.word : card.phrase).revision !== undefined;

/** Дубликат фразы — тот же текст с тем же переводом; фраза без перевода не равна фразе с переводом. */
export const phraseKey = (text: string, translation: string | undefined) =>
  `${normalize(text)} ${translation === undefined ? "" : normalize(translation)}`;
