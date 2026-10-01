import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Dumbbell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { DailyPlan } from "../../domain/learning";
import { useAction } from "../../shared/action";
import { lessonIn, withCount } from "../../shared/format";
import { useActiveSession } from "../../shared/store";
import { moduleViews } from "../../storage/course";
import { dexieSource } from "../../storage/queries";
import { CourseNext } from "../course/CourseNext";
import { ExamLine } from "../course/ExamLine";
import { startSession } from "../learning/session-actions";
import { DayNotes } from "./DayNotes";
import ui from "../../shared/ui.module.css";

/**
 * «Сегодня» курса из модулей: сначала следующий урок программы, потом повторение карточек пройденных уроков.
 * Расписания занятий у курса нет — темп задаёт программа, а не даты уроков.
 */
export function CourseToday({ plan, now }: { plan: DailyPlan; now: Date }) {
  const navigate = useNavigate();
  const unfinished = useActiveSession();
  const { busy, problem, setProblem, run } = useAction("Не удалось начать повторение");
  const views = useLiveQuery(() => moduleViews(), []);
  const courseId = views?.[0]?.module.courseId;

  const lessons = (views ?? []).flatMap((view) => [
    ...view.lessons,
    ...(view.checkpoint ? [view.checkpoint] : []),
    ...view.review,
  ]);
  const last = lessons.filter((lesson) => lesson.completed).at(-1);
  const finished = !!lessons.length && lessons.every((lesson) => lesson.completed);
  const fresh = plan.newRefs.length;
  const reviews = plan.reviews.length;

  const review = () =>
    run(async () => {
      if (unfinished) return navigate("/session");
      if (!(await startSession(now))) return setProblem("На сегодня карточек нет.");
      void navigate("/session");
    });
  // Тренировка не сдвигает интервалы: навык фиксируется, расписание повторений остаётся прежним.
  const practice = () =>
    run(async () => {
      if (!last) return;
      const refs = await dexieSource().lessonRefs(last.id);
      const session = refs.length ? await startSession(now, { refs, mode: "practice" }) : null;
      if (!session) return setProblem("В уроке нет карточек для тренировки.");
      void navigate("/session");
    });

  return (
    <>
      <h1 data-testid="today-title">Сегодня</h1>
      {finished ? (
        <p className={`${ui.note} mb-4`} data-testid="course-finished">
          Все модули и пробники пройдены. До экзамена — повторение карточек и слабый навык по итогам M3.
        </p>
      ) : (
        <CourseNext />
      )}

      <h2>Карточки</h2>
      {unfinished ? (
        <Button size="xl" onClick={review} disabled={busy}>
          Продолжить повторение
          <ArrowRight data-icon="inline-end" />
        </Button>
      ) : fresh || reviews ? (
        <>
          <p className={`${ui.note} mb-2.5`} data-testid="cards-today">
            {[
              fresh && withCount(fresh, ["новая", "новые", "новых"]),
              reviews && withCount(reviews, ["повторение", "повторения", "повторений"]),
            ]
              .filter(Boolean)
              .join(" и ")}
          </p>
          <Button size="xl" onClick={review} disabled={busy}>
            Повторить карточки
            <ArrowRight data-icon="inline-end" />
          </Button>
        </>
      ) : last ? (
        <>
          <p className={`${ui.note} mb-2.5`} data-testid="day-done">
            Карточки на сегодня повторены. Тренировка не сдвигает интервалы повторений.
          </p>
          <Button
            size="xl"
            variant="soft"
            className="min-w-0 max-w-full"
            title={`Потренировать ${lessonIn(last.title, "урок")}`}
            onClick={practice}
            disabled={busy}
          >
            <Dumbbell data-icon="inline-start" />
            <span className="min-w-0 truncate">Потренировать {lessonIn(last.title, "урок")}</span>
          </Button>
        </>
      ) : (
        <p className={ui.note} data-testid="cards-later">
          Карточки появятся после первого пройденного урока.
        </p>
      )}
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
      <DayNotes plan={plan} now={now} />

      {courseId && (
        <div className="mt-6">
          <ExamLine courseId={courseId} />
        </div>
      )}
    </>
  );
}
