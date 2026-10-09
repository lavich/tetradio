import { useLiveQuery } from "dexie-react-hooks";
import { Volume2 } from "lucide-react";
import { toast } from "sonner";
import type { LessonItem } from "../../domain/types";
import { languageOfText } from "../../domain/language";
import { playText, playWord, type PlayResult } from "../../shared/audio";
import { noVoice } from "../../shared/language";
import { useAssetUrl } from "../../shared/store";
import { livePhrases, liveWords } from "../../storage/queries";
import css from "./vocabulary.module.css";

/** Картинка слова из библиотеки; пока файл не загружен — пустое место того же размера, чтобы строка не прыгала. */
function Thumb({ assetId }: { assetId?: string }) {
  const url = useAssetUrl(assetId);
  if (!assetId) return null;
  return url ? (
    <img className={css.thumb} src={url} alt="" role="presentation" />
  ) : (
    <span className={css.thumb} aria-hidden />
  );
}

const heard = (text: string) => (result: PlayResult) => {
  if (result === "none") toast(noVoice(languageOfText(text)));
  if (result === "error") toast("Не удалось воспроизвести произношение.");
};

/** Слова и фразы урока списком, как в тетради-словарике: картинка, слово с артиклем, формы, перевод. */
export function VocabularyList({ items }: { items: LessonItem[] }) {
  const wordIds = items.filter((item) => item.ref.kind === "word").map((item) => item.ref.id);
  const phraseIds = items.filter((item) => item.ref.kind === "phrase").map((item) => item.ref.id);
  const words = useLiveQuery(() => liveWords(wordIds), [wordIds.join()]);
  const phrases = useLiveQuery(() => livePhrases(phraseIds), [phraseIds.join()]);
  if (!words || !phrases) return null;
  const byId = new Map(words.map((word) => [word.id, word]));
  return (
    <>
      <ul className={css.vocab}>
        {wordIds.map((id) => {
          const word = byId.get(id);
          if (!word) return null;
          return (
            <li key={id}>
              <button
                type="button"
                className={css.vocabRow}
                aria-label={`Произнести: ${word.greek}`}
                onClick={() => void playWord(word).then(heard(word.greek))}
              >
                <Thumb assetId={word.imageAssetId} />
                <span className={css.vocabText}>
                  <span className={css.vocabGreek} lang={languageOfText(word.greek).code}>
                    {word.greek}
                  </span>
                  {word.forms ? (
                    <span className={css.vocabForms} lang={languageOfText(word.greek).code}>
                      {word.forms}
                    </span>
                  ) : null}
                  <span className={css.vocabRu}>{word.russian}</span>
                </span>
                <Volume2 className={css.vocabSound} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {phrases.length ? (
        <ul className={css.vocab}>
          {phrases.map((phrase) => (
            <li key={phrase.id}>
              <button
                type="button"
                className={css.vocabRow}
                aria-label={`Произнести: ${phrase.text}`}
                onClick={() => void playText(phrase.text, phrase.audioAssetId).then(heard(phrase.text))}
              >
                <span className={css.vocabText}>
                  <span className={css.vocabGreek} lang={languageOfText(phrase.text).code}>
                    {phrase.text}
                  </span>
                  {phrase.translation ? <span className={css.vocabRu}>{phrase.translation}</span> : null}
                </span>
                <Volume2 className={css.vocabSound} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
