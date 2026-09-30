import type { Card } from "ts-fsrs";
import { itemOfLink, unitKey, wordKeyOf, wordRef } from "../../src/domain/refs";
import type { LearningRef, LearningState, LessonWord, ReviewEvent, SessionItem } from "../../src/domain/types";

/** Помощники словарных тестов: прежние сценарии остаются про слова, а форма записей — типизированная. */
export { itemOfLink, unitKey, wordKeyOf, wordRef };
export const wordState = (wordId: string, rest: Omit<LearningState, "unitKey" | "ref">): LearningState => ({
  unitKey: wordKeyOf(wordId),
  ref: wordRef(wordId),
  ...rest,
});
export const wordEvent = (wordId: string, rest: Omit<ReviewEvent, "unitKey" | "ref">): ReviewEvent => ({
  ref: wordRef(wordId),
  unitKey: wordKeyOf(wordId),
  ...rest,
});
export const idsOf = (refs: LearningRef[]) => refs.map((ref) => ref.id);
export const wordIdOf = (item: Pick<SessionItem, "ref">) => item.ref.id;
export const cardOf = (state: { card: Card }) => state.card;
export type { LessonWord };
