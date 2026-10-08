import { languageOfText } from "../../../domain/language";
import { ExampleBox, SpeakButton } from "../../words/WordCardView";
import s from "./exercise.module.css";
import { Choice } from "./Choice";
import { useAutoSpeak } from "./hooks";
import { wordOf, type ExerciseProps } from "./model";
import { GreekHead } from "./parts";
import { SpeakText } from "./SpeakText";

export function Recognition(props: ExerciseProps & { autoSpeak?: boolean }) {
  const { card } = props.item;
  // Узнавание проверяет значение, а звучит показанное написание: подсказки нет, поэтому карточка озвучивается сама.
  useAutoSpeak(card, !!props.autoSpeak);
  if (card.kind === "phrase") {
    const phrase = card.phrase;
    return (
      <Choice
        {...props}
        prompt="Что значит эта фраза?"
        correct={phrase.translation ?? ""}
        options={props.item.options}
        head={
          <p className={s.phrase} lang={languageOfText(phrase.text).code}>
            {phrase.text}
          </p>
        }
        aside={<SpeakText text={phrase.text} audioAssetId={phrase.audioAssetId} label="Послушать фразу" quiet />}
        after={phrase.usage ? <p className={s.hint}>{phrase.usage}</p> : undefined}
      />
    );
  }
  const word = wordOf(card);
  return (
    <Choice
      {...props}
      prompt="Что значит это слово?"
      correct={word.russian}
      options={props.item.options}
      head={<GreekHead text={word.greek} ipa={word.ipa} speak={<SpeakButton word={word} quiet />} />}
      after={word.examples[0] && <ExampleBox example={word.examples[0]} bare />}
    />
  );
}
