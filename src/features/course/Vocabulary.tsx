import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import type { LessonItem } from "../../domain/types";
import { useAssetUrl } from "../../shared/store";
import { livePhrases, liveWords } from "../../storage/queries";
import css from "./course.module.css";

/** Картинка слова из библиотеки; пока файл не загружен — пустое место того же размера, чтобы строка не прыгала. */
function Thumb({ assetId }: { assetId?: string }) {
  const url = useAssetUrl(assetId);
  if (!assetId) return <span className={css.thumb} aria-hidden />;
  return url ? (
    <img className={css.thumb} src={url} alt="" role="presentation" />
  ) : (
    <span className={css.thumb} aria-hidden />
  );
}

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
              <Link to={`/words/${id}`} className={css.vocabRow}>
                <Thumb assetId={word.imageAssetId} />
                <span className={css.vocabText}>
                  <span className={css.vocabGreek} lang="el">
                    {word.greek}
                  </span>
                  {word.forms ? (
                    <span className={css.vocabForms} lang="el">
                      {word.forms}
                    </span>
                  ) : null}
                  <span className={css.vocabRu}>{word.russian}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {phrases.length ? (
        <ul className={css.vocab}>
          {phrases.map((phrase) => (
            <li key={phrase.id} className={css.vocabPhrase}>
              <span className={css.vocabGreek} lang="el">
                {phrase.text}
              </span>
              {phrase.translation ? <span className={css.vocabRu}>{phrase.translation}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
