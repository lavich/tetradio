import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Screen } from "../../app/Screen";
import { moduleViews, type ModuleView } from "../../storage/course";
import { courses, shelfCourse } from "../../storage/courses";
import { db } from "../../storage/db";
import { CourseSwitch } from "../../shared/CourseSwitch";
import { useAction } from "../../shared/action";
import { pausedSince } from "../../shared/format";
import { pauseCourse, resumeCourse } from "../../storage/pause-actions";
import { CourseMenu } from "./CourseMenu";
import { useCourseProfile } from "../../shared/language";
import { Tick } from "../../shared/Tick";
import { coverColor, mutedCover } from "../../shared/notebook";
import { CourseStart } from "../today/FirstRun";
import { checkpointLabels } from "./checkpoints";
import { ExamLine } from "./ExamLine";
import base from "./course.module.css";
import css from "./shelf.module.css";

function coverLabel(view: ModuleView) {
  if (view.module.status === "draft") return "Готовится";
  if (view.completed) return "Заполнена";
  const done = view.lessons.filter((lesson) => lesson.completed).length;
  return done ? `Урок ${done + 1} из ${view.lessons.length}` : "Открыта";
}

export function CourseScreen() {
  const data = useLiveQuery(async () => {
    const courseId = await shelfCourse();
    const entry = (await courses()).find((course) => course.id === courseId && course.started);
    return { courseId, pausedAt: entry?.pausedAt, views: entry ? await moduleViews(courseId) : [] };
  }, []);
  const [status, setStatus] = useState("");
  const { busy, problem, setProblem, run } = useAction("Не удалось изменить курс");
  const courseId = data?.courseId;
  const trigger = useRef<HTMLButtonElement>(null);
  const resume = useRef<HTMLButtonElement>(null);
  // Кнопка, нажатая для паузы или возврата, исчезает: фокус переходит на ту, что её заменила, а не на body.
  const focusAfter = useRef<"resume" | "menu" | null>(null);
  const pausedNow = data?.pausedAt;
  useEffect(() => {
    if (focusAfter.current === "resume" && pausedNow) resume.current?.focus();
    else if (focusAfter.current === "menu" && !pausedNow) trigger.current?.focus();
    else return;
    focusAfter.current = null;
  }, [pausedNow]);
  useEffect(() => {
    setStatus("");
    setProblem("");
  }, [courseId, setProblem]);
  const course = useLiveQuery(async () => (courseId ? await db.courses.get(courseId) : undefined), [courseId]);
  const profile = useCourseProfile(courseId);
  if (data === undefined) return <Screen />;
  const { views, pausedAt } = data;
  const title = course?.short ?? course?.title ?? "";
  const toggle = () => {
    if (busy || !courseId) return;
    focusAfter.current = pausedAt ? "menu" : "resume";
    return run(async () => {
      if (pausedAt) {
        await resumeCourse(courseId);
        setStatus(`Курс «${title}» продолжается.`);
      } else {
        await pauseCourse(courseId);
        setStatus(`Курс «${title}» на паузе. Вернуть его можно на полке или в настройках.`);
      }
    });
  };
  const statusLine = (
    <p className="sr-only" role="status" data-testid="shelf-status">
      {status}
    </p>
  );
  if (!views.length)
    return (
      <Screen>
        <CourseSwitch shelf />
        <h1>Полка</h1>
        <CourseStart courseId={courseId} />
        {statusLine}
      </Screen>
    );
  const filled = views.filter((view) => view.completed).length;
  const current = views.find((view) => view.module.status === "published" && !view.completed)?.module.id;
  const labels = checkpointLabels(course?.calendar);
  return (
    <Screen>
      <CourseSwitch shelf />
      <div className="flex items-center justify-between gap-3">
        <h1>Полка</h1>
        <span className="flex items-center gap-1">
          <span className={base.meta}>
            {filled} из {views.length} заполнено
          </span>
          <CourseMenu title={title} paused={!!pausedAt} onToggle={() => void toggle()} trigger={trigger} />
        </span>
      </div>
      <ExamLine courseId={views[0].module.courseId} />
      {statusLine}
      {problem && (
        <p className={css.problem} role="alert">
          {problem}
        </p>
      )}
      {pausedAt && (
        <div className={css.paused} data-testid="shelf-paused">
          <p className={css.pausedText}>На паузе с {pausedSince(pausedAt)}</p>
          <Button ref={resume} size="md" className="w-auto" onClick={() => void toggle()} aria-disabled={busy}>
            Продолжить курс
          </Button>
        </div>
      )}
      <div className={css.shelf}>
        {views.map((view) => {
          const { module } = view;
          const draft = module.status === "draft";
          const classes = [css.cover, draft ? css.draft : "", module.id === current ? css.current : ""].join(" ");
          return (
            <FragmentWithCheckpoint key={module.id} view={view} labels={labels}>
              <Link
                to={`/course/${module.id}`}
                className={classes}
                style={
                  draft ? undefined : { background: pausedAt ? mutedCover(module.number) : coverColor(module.number) }
                }
                aria-label={`Модуль ${module.number}: ${module.subtitle}. ${coverLabel(view)}`}
              >
                {view.completed ? <Tick className={css.coverStamp} label="заполнена" /> : null}
                <span className={css.coverNumber}>{String(module.number).padStart(2, "0")}</span>
                <span className={css.coverTitle} lang={profile.code}>
                  {module.title}
                </span>
                <span className={css.coverLabel}>{coverLabel(view)}</span>
              </Link>
            </FragmentWithCheckpoint>
          );
        })}
      </div>
    </Screen>
  );
}
/** Метка контрольной точки после модуля; когда точка опубликована — ссылка на неё, после прохождения — с галочкой. */
function FragmentWithCheckpoint({
  view,
  labels,
  children,
}: {
  view: ModuleView;
  labels: Record<number, string>;
  children: React.ReactNode;
}) {
  const point = view.checkpoint;
  const label = labels[view.module.number] ?? point?.title;
  return (
    <>
      {children}
      {label ? (
        point ? (
          <Link to={`/course/${view.module.id}/${point.id}`} className={`${css.checkpoint} ${css.checkpointLink}`}>
            {point.completed ? <Tick className={css.checkpointTick} label="пройдена" /> : null}
            {label}
          </Link>
        ) : (
          <div className={css.checkpoint}>{label}</div>
        )
      ) : null}
    </>
  );
}
