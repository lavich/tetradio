import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAction } from "../../shared/action";
import { useCourseSession } from "../../shared/courses";
import { usePlan } from "../../shared/store";
import { moduleViews } from "../../storage/course";
import type { CourseEntry } from "../../storage/courses";
import { sessionPath, startSession } from "../learning/session-actions";
import { nextStep } from "./CourseToday";
import css from "./today.module.css";

/** Второй курс на «Сегодня» — одной строкой под основным: следующий урок и повторение своих карточек. */
export function OtherCourse({ course, now }: { course: CourseEntry; now: Date }) {
  const navigate = useNavigate();
  const plan = usePlan(now, course.id);
  const views = useLiveQuery(() => moduleViews(course.id), [course.id]);
  const unfinished = useCourseSession(course.id);
  const { busy, problem, setProblem, run } = useAction("Не удалось начать повторение");
  if (!plan || !views || unfinished === undefined) return null;
  const next = nextStep(views);
  const due = plan.newRefs.length + plan.reviews.length;
  const review = () =>
    run(async () => {
      if (!unfinished && !(await startSession(now, { courseId: course.id })))
        return setProblem("На сегодня карточек нет.");
      void navigate(await sessionPath(course.id));
    });
  const titleId = `course-${course.id}`;
  return (
    <section className={css.other} aria-labelledby={titleId} data-testid="other-course">
      <div className={css.otherHead}>
        <h2 id={titleId} className={css.otherTitle}>
          {course.title}
        </h2>
        {unfinished || due ? (
          <Button size="md" variant="soft" className="w-auto flex-none" onClick={review} disabled={busy}>
            {unfinished ? "Продолжить" : `Повторить ${due}`}
          </Button>
        ) : (
          <span className={css.otherNone}>повторений нет</span>
        )}
      </div>
      {next ? (
        <Link to={`/course/${next.view.module.id}/${next.lesson.id}`} className={css.otherLesson}>
          <span className="min-w-0 truncate">
            {next.lesson.tally.done ? "Продолжить" : "Урок"}: {next.lesson.title}
          </span>
          <ArrowRight aria-hidden size={16} />
        </Link>
      ) : views.length ? (
        <p className={css.otherNone}>Все уроки пройдены</p>
      ) : null}
      {problem && (
        <p className={css.problem} role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
