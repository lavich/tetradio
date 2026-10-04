import type { SessionCard, SessionItem, Word } from "../../../domain/types";

export interface Answer {
  correct: boolean;
  text: string;
  status?: "correct" | "almost" | "wrong";
}
/** onAnswer возвращает false, если запись не удалась: тогда упражнение остаётся открытым для повтора. `onSkip` — пропуск без оценки. */
export interface ExerciseProps {
  item: SessionItem;
  onAnswer: (answer: Answer) => Promise<boolean>;
  onNext: () => void;
  onSkip?: () => void;
  /** Подпись кнопки после ответа: в занятии — «Далее», в упражнении по выбору — «Ещё раз». */
  nextLabel?: string;
}
export type Status = "correct" | "almost" | "wrong";

/** Слово карточки; для других видов упражнения слов не создаются. */
export const wordOf = (card: SessionCard): Word => {
  if (card.kind !== "word") throw new Error("Упражнение для слова получило другую карточку");
  return card.word;
};
