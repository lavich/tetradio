import { Choice } from "./Choice";
import { wordOf, type ExerciseProps } from "./model";
import { PhraseReveal, Reveal, WordReveal } from "./parts";
import { ReplayHead, useReplay } from "./replay";

/**
 * Аудирование. Отказ воспроизведения не засчитывается как ошибка знания: можно повторить или продолжить без аудио —
 * упражнение пропускается без события и без сдвига интервалов. Варианты для фразы — фразы, для слова — слова.
 * После ответа раскрывается карточка со значением: выбрать написание на слух можно и не зная смысла,
 * поэтому верный ответ показывает её наравне с ошибкой и с «Не знаю». Показ ничего не сохраняет.
 */
export function Listening(props: ExerciseProps & { autoSpeak?: boolean }) {
  const { card } = props.item;
  const replay = useReplay(card, props.item.id, props.autoSpeak);
  return (
    <Choice
      {...props}
      audio
      prompt="Что прозвучало?"
      correct={replay.text}
      options={props.item.options}
      greekOptions
      head={<ReplayHead replay={replay} onSkip={props.onSkip} />}
      after={
        <Reveal>
          {card.kind === "phrase" ? <PhraseReveal phrase={card.phrase} /> : <WordReveal word={wordOf(card)} />}
        </Reveal>
      }
    />
  );
}
