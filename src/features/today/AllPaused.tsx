import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAction } from "../../shared/action";
import { useAllCourses, useCurrentLanguage } from "../../shared/courses";
import { resumeCourse } from "../../storage/pause-actions";
import { pausedSince } from "../../shared/format";
import type { CourseEntry } from "../../storage/courses";
import { titleFocus } from "./CourseToday";
import css from "./today.module.css";

/** «Сегодня», когда все начатые курсы на паузе: вернуть любой из них или начать другой. */
export function AllPaused({ started }: { started: CourseEntry[] }) {
  const navigate = useNavigate();
  const [, choose] = useCurrentLanguage();
  const next = useAllCourses()?.find((course) => !course.started);
  const { busy, problem, run } = useAction("Не удалось продолжить курс");
  const start = useAction("Не удалось открыть курс");
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
              aria-disabled={busy}
              onClick={() => {
                if (busy) return;
                titleFocus.pending = true;
                void run(() =>
                  resumeCourse(course.id).catch((error: unknown) => {
                    titleFocus.pending = false;
                    throw error;
                  }),
                );
              }}
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
          aria-disabled={start.busy}
          onClick={() =>
            !start.busy &&
            void start.run(async () => {
              await choose(next.language);
              void navigate("/course", { state: { course: next.id } });
            })
          }
        >
          Начать другой курс
        </Button>
      )}
      {start.problem && (
        <p className={css.problem} role="alert">
          {start.problem}
        </p>
      )}
    </>
  );
}
