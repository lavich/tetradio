import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Info, Pencil, Share2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Screen } from "../../app/Screen";
import { useNow } from "../../shared/clock";
import { wordRef } from "../../domain/refs";
import { shortTitle } from "../../shared/format";
import { useShippedWord, useWord, useWordLesson, useWordLessons } from "../../shared/store";
import { shareWord } from "../../platform/share";
import { ExampleBox, ReadingNotes, WordSummary } from "./WordCardView";
import { WORD_EXERCISES } from "../../domain/learning";
import type { Word } from "../../domain/types";
import { EXERCISE_LABELS, exercisePath, useWordExercises } from "./word-exercises";
import { startSession } from "../learning/session-actions";
import ui from "../../shared/ui.module.css";

export function WordScreen() {
  const { id } = useParams();
  const word = useWord(id);
  const lessons = useWordLessons(word?.id);
  // Делиться можно только словом курса: ссылка открывает его версию из каталога, а не локальную запись.
  const shipped = useWordLesson(word?.id);
  const original = useShippedWord(word?.id);
  const now = useNow();
  const navigate = useNavigate();
  const [problem, setProblem] = useState("");
  if (!word)
    return (
      <Screen back="Слово">
        <p className={ui.muted}>Слово не найдено.</p>
      </Screen>
    );
  const practice = async () => {
    const session = await startSession(now, { refs: [wordRef(word.id)], mode: "practice" });
    if (!session) return setProblem("Не удалось собрать тренировку для этого слова.");
    void navigate("/session");
  };
  return (
    <Screen
      back={lessons[0] ? lessons[0].title : "Слово"}
      right={
        <div className="flex items-center">
          {shipped && !word.deletedAt && (
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-11"
              aria-label="Поделиться словом"
              onClick={() => void shareWord(original ?? word)}
            >
              <Share2 />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-11"
            aria-label="Редактировать слово"
            render={<Link to={`/words/${word.id}/edit`} />}
          >
            <Pencil />
          </Button>
        </div>
      }
    >
      <WordSummary word={word} />
      {!word.verified && <p className={ui.note}>Фонетика не проверена — её можно уточнить в редакторе.</p>}
      <ReadingNotes word={word} />
      {word.examples.length ? (
        word.examples.map((example, index) => <ExampleBox key={index} example={example} linkFrom={word.id} />)
      ) : (
        <Alert className="mb-3">
          <Info />
          <AlertDescription>
            Примера употребления пока нет. <Link to={`/words/${word.id}/edit`}>Добавить пример</Link>
          </AlertDescription>
        </Alert>
      )}
      <p>
        {lessons.map((lesson) => (
          <Link key={lesson.id} to={`/lessons/${lesson.id}`} style={{ textDecoration: "none", marginRight: 8 }}>
            <Badge variant="soft" className="h-7 px-3 text-sm">
              {shortTitle(lesson.title)}
            </Badge>
          </Link>
        ))}
      </p>
      <Button variant="soft" size="xl" onClick={practice}>
        Потренировать слово
      </Button>
      {problem && <p className={ui.error}>{problem}</p>}
      {!word.deletedAt && <ExerciseChoice word={word} />}
    </Screen>
  );
}

function ExerciseChoice({ word }: { word: Word }) {
  const options = useWordExercises(word);
  const navigate = useNavigate();
  return (
    <section aria-labelledby="word-exercises" style={{ marginTop: 24 }}>
      <h2 id="word-exercises" style={{ fontSize: 17, margin: 0 }}>
        Упражнения
      </h2>
      <p className={ui.note} style={{ margin: "2px 0 10px" }}>
        Без учёта прогресса
      </p>
      <div className="flex flex-col gap-2" data-testid="word-exercises">
        {WORD_EXERCISES.map((type) => {
          const status = options?.[type];
          return (
            <div key={type} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p style={{ margin: 0 }}>{EXERCISE_LABELS[type]}</p>
                {status && !status.available && (
                  <p className={ui.note} style={{ margin: 0 }}>
                    {status.reason}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="md"
                className="w-auto shrink-0"
                disabled={!status?.available}
                aria-label={`${EXERCISE_LABELS[type]}: пройти`}
                onClick={() => void navigate(exercisePath(word.id, type))}
              >
                Пройти
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
