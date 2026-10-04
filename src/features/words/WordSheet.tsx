import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Share2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { WORD_EXERCISES } from "../../domain/learning";
import type { LearningRef, Phrase, Word } from "../../domain/types";
import { shareWord } from "../../platform/share";
import { useNow } from "../../shared/clock";
import { usePhrase, useWordLesson } from "../../shared/store";
import { db } from "../../storage/db";
import { Tick } from "../../shared/Tick";
import type { DictionaryLesson } from "../../storage/dictionary";
import { dexieSource } from "../../storage/queries";
import { SpeakText } from "../learning/exercises";
import { startSession } from "../learning/session-actions";
import { ExampleBox, ReadingNotes, SpeakButton, WordArt } from "./WordCardView";
import { EXERCISE_LABELS, exercisePath, useWordExercises } from "./word-exercises";
import css from "./dictionary.module.css";

export function EntrySheet({
  kind,
  id,
  lessons,
}: {
  kind: "word" | "phrase";
  id: string;
  lessons: DictionaryLesson[];
}) {
  const word = useLiveQuery(async () => (kind === "word" ? ((await db.words.get(id)) ?? null) : undefined), [kind, id]);
  const phrase = usePhrase(kind === "phrase" ? id : undefined);
  const lesson = lessons.find((item) => item.entries.some((entry) => entry.ref.kind === kind && entry.ref.id === id));
  const card = kind === "word" ? word : phrase;
  if (card === undefined) return null;
  if (!card) return <p className={css.empty}>{kind === "word" ? "Слово не найдено." : "Фраза не найдена."}</p>;
  return (
    <article className={css.sheet} aria-label={kind === "word" ? word!.greek : phrase!.text} data-testid="entry-sheet">
      {lesson?.moduleId && (
        <Link className={css.from} to={`/course/${lesson.moduleId}/${lesson.id}`}>
          {lesson.number ? `Урок ${lesson.number} · ` : ""}
          <span lang="el">{lesson.title}</span> →
        </Link>
      )}
      {word ? <WordBody word={word} /> : <PhraseBody phrase={phrase!} />}
    </article>
  );
}

function WordBody({ word }: { word: Word }) {
  const shipped = useWordLesson(word.id);
  return (
    <>
      <div className={css.head}>
        <div className="min-w-0 flex-1">
          <p className={css.big} lang="el">
            {word.greek}
          </p>
          {word.ipa && <p className={css.ipa}>{word.ipa}</p>}
        </div>
        <WordArt word={word} className={css.art} />
        <SpeakButton word={word} />
      </div>
      <p className={css.meaning}>{word.russian}</p>
      {word.forms && (
        <p className={css.forms} lang="el">
          {word.forms}
        </p>
      )}
      <ReadingNotes word={word} bare />
      {word.examples.map((example, index) => (
        <ExampleBox key={index} example={example} linkFrom={word.id} bare />
      ))}
      <Skills word={word} />
      <Practice ref_={{ kind: "word", id: word.id }} label="Потренировать слово" />
      {shipped && (
        <button type="button" className={css.quiet} aria-label="Поделиться словом" onClick={() => void shareWord(word)}>
          <Share2 aria-hidden size={16} /> Поделиться словом
        </button>
      )}
    </>
  );
}

function PhraseBody({ phrase }: { phrase: Phrase }) {
  return (
    <>
      <div className={css.head}>
        <p className={`${css.big} ${css.bigPhrase} min-w-0 flex-1`} lang="el">
          {phrase.text}
        </p>
        <SpeakText text={phrase.text} audioAssetId={phrase.audioAssetId} label="Послушать фразу" />
      </div>
      {phrase.translation && <p className={css.meaning}>{phrase.translation}</p>}
      {(phrase.usage || phrase.note) && (
        <p className={css.forms}>{[phrase.usage, phrase.note].filter(Boolean).join(" · ")}</p>
      )}
      <Practice ref_={{ kind: "phrase", id: phrase.id }} label="Потренировать фразу" />
    </>
  );
}

/** Навыки слова по типам проверки: галочка — последний ответ этого типа верный; тренировка не сдвигает интервалы. */
function Skills({ word }: { word: Word }) {
  const options = useWordExercises(word);
  const skills = useLiveQuery(() => dexieSource().skillsOf({ kind: "word", word }), [word.id]);
  const navigate = useNavigate();
  return (
    <section className={css.skills} aria-labelledby="word-skills">
      <h2 id="word-skills" className={css.skillsTitle}>
        Навыки слова
      </h2>
      <p className={css.note}>Тренировка — без учёта прогресса: интервалы повторения не меняются.</p>
      <ul data-testid="word-exercises">
        {WORD_EXERCISES.map((type) => {
          const status = options?.[type];
          const recent = skills?.types[type]?.recent ?? [];
          const passed = recent.at(-1) === true;
          return (
            <li key={type}>
              <span className={css.skillName}>{EXERCISE_LABELS[type]}</span>
              {passed ? (
                <Tick className={css.tick} label="последний ответ верный" />
              ) : (
                <i
                  className={css.mark}
                  role="img"
                  aria-label={recent.length ? "последний ответ с ошибкой" : "ещё не проверяли"}
                />
              )}
              {status && !status.available ? (
                <span className={css.reason}>{status.reason}</span>
              ) : (
                <button
                  type="button"
                  className={css.go}
                  disabled={!status}
                  aria-label={`${EXERCISE_LABELS[type]}: потренировать`}
                  onClick={() => void navigate(exercisePath(word.id, type))}
                >
                  потренировать
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Practice({ ref_, label }: { ref_: LearningRef; label: string }) {
  const now = useNow();
  const navigate = useNavigate();
  const [problem, setProblem] = useState("");
  const practice = async () => {
    const session = await startSession(now, { refs: [ref_], mode: "practice" });
    if (!session) return setProblem("Не удалось собрать тренировку.");
    void navigate("/session");
  };
  return (
    <>
      <Button variant="soft" size="md" className="mt-4" onClick={practice}>
        {label}
      </Button>
      {problem && (
        <p className={css.problem} role="alert">
          {problem}
        </p>
      )}
    </>
  );
}
