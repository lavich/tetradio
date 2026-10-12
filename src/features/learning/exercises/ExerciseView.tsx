import type { SessionItem } from "../../../domain/types";
import { Assembly } from "./Assembly";
import { Comprehension } from "./Comprehension";
import { LessonTask } from "./LessonTask";
import { Listening } from "./Listening";
import type { Answer } from "./model";
import { Recognition } from "./Recognition";
import { Spelling } from "./Spelling";
import { WordGap } from "./WordGap";

/** Упражнение по типу задания; пропуск без оценки есть только у аудиоупражнений. */
export function ExerciseView({
  item,
  onAnswer,
  onNext,
  onSkip,
  nextLabel,
  autoSpeak,
}: {
  item: SessionItem;
  onAnswer: (answer: Answer) => Promise<boolean>;
  onNext: () => void;
  onSkip: () => void;
  nextLabel?: string;
  autoSpeak: boolean;
}) {
  const props = { item, onAnswer, onNext, nextLabel, autoSpeak };
  // key по упражнению: иначе следующая карточка успевает показаться с ответом предыдущей.
  return item.type === "recognition" ? (
    <Recognition key={item.id} {...props} />
  ) : item.type === "listening" ? (
    <Listening key={item.id} {...props} onSkip={onSkip} />
  ) : item.type === "comprehension" ? (
    <Comprehension key={item.id} {...props} onSkip={onSkip} />
  ) : item.type === "assembly" ? (
    <Assembly key={item.id} {...props} />
  ) : item.type === "wordGap" ? (
    <WordGap key={item.id} {...props} />
  ) : item.type === "item" ? (
    <LessonTask key={item.id} {...props} />
  ) : (
    <Spelling key={item.id} {...props} />
  );
}
