import { Choice } from "./Choice";
import type { ExerciseProps } from "./model";
import { PhraseReveal, Reveal, WordReveal } from "./parts";
import { ReplayHead, useReplay } from "./replay";

/**
 * Понимание на слух: звучит слово или фраза, варианты ответа — переводы. До ответа письменной опоры нет,
 * иначе проверялось бы чтение. После ответа раскрывается та же карточка со значением, что и в аудировании:
 * из ошибки должно быть что извлечь. Отказ воспроизведения тоже ведёт себя как в аудировании.
 */
export function Comprehension(props: ExerciseProps & { autoSpeak?: boolean }) {
  const { card } = props.item;
  const replay = useReplay(card, props.item.id, props.autoSpeak);
  const correct =
    card.kind === "word" ? card.word.russian : card.kind === "phrase" ? (card.phrase.translation ?? "") : "";
  return (
    <Choice
      {...props}
      audio
      prompt="Что это значит?"
      correct={correct}
      options={props.item.options}
      head={<ReplayHead replay={replay} onSkip={props.onSkip} />}
      after={
        <Reveal>
          {card.kind === "word" ? (
            <WordReveal word={card.word} />
          ) : card.kind === "phrase" ? (
            <PhraseReveal phrase={card.phrase} />
          ) : null}
        </Reveal>
      }
    />
  );
}
