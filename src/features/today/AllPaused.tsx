import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAction } from "../../shared/action";
import { resumeCourse, useAllCourses, useCurrentCourse } from "../../shared/courses";
import { pausedSince } from "../../shared/format";
import type { CourseEntry } from "../../storage/courses";
import css from "./today.module.css";

/** «Сегодня», когда все начатые курсы на паузе: вернуть любой из них или начать другой. */
export function AllPaused({ started }: { started: CourseEntry[] }) {
  const navigate = useNavigate();
  const [, choose] = useCurrentCourse();
  const next = useAllCourses()?.find((course) => !course.started);
  const { busy, problem, run } = useAction("Не удалось продолжить курс");
  return (
    <>
      <h1 data-testid="today-title">Все курсы на паузе</h1>
      {started.map((course) => (
        <section
          key={course.id}
          className={css.other}
          aria-labelledby={`paused-${course.id}`}
          data-testid="paused-course"
        >
          <div className={css.otherHead}>
            <div className="min-w-0">
              <h2 id={`paused-${course.id}`} className={css.otherTitle}>
                {course.title}
              </h2>
              {course.pausedAt && <p className={css.otherNone}>На паузе с {pausedSince(course.pausedAt)}</p>}
            </div>
            <Button
              size="md"
              variant="soft"
              className="w-auto flex-none"
              disabled={busy}
              onClick={() => run(() => resumeCourse(course.id))}
              aria-label={`Продолжить курс «${course.title}»`}
            >
              Продолжить
            </Button>
          </div>
        </section>
      ))}
      {problem && (
        <p className={css.problem} role="alert">
          {problem}
        </p>
      )}
      {next && (
        <Button
          size="md"
          variant="outline"
          className="mt-6 w-auto"
          onClick={() =>
            run(async () => {
              await choose(next.id);
              void navigate("/course");
            })
          }
        >
          Начать другой курс
        </Button>
      )}
    </>
  );
}
