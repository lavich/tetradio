import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { Screen } from "../../app/Screen";
import { languageOfText } from "../../domain/language";
import { moduleViews, type ModuleView } from "../../storage/course";
import { db } from "../../storage/db";
import { Tick } from "../../shared/Tick";
import { coverColor } from "../../shared/notebook";
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
  const views = useLiveQuery(() => moduleViews(), []);
  const courseId = views?.[0]?.module.courseId;
  const course = useLiveQuery(async () => (courseId ? await db.courses.get(courseId) : undefined), [courseId]);
  if (views === undefined) return <Screen />;
  if (!views.length)
    return (
      <Screen>
        <h1>Полка</h1>
        <CourseStart />
      </Screen>
    );
  const filled = views.filter((view) => view.completed).length;
  const current = views.find((view) => view.module.status === "published" && !view.completed)?.module.id;
  const labels = checkpointLabels(course?.calendar);
  return (
    <Screen>
      <div className="flex items-baseline justify-between gap-3">
        <h1>Полка</h1>
        <span className={base.meta}>
          {filled} из {views.length} заполнено
        </span>
      </div>
      <ExamLine courseId={views[0].module.courseId} />
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
                style={draft ? undefined : { background: coverColor(module.number) }}
                aria-label={`Модуль ${module.number}: ${module.subtitle}. ${coverLabel(view)}`}
              >
                {view.completed ? <Tick className={css.coverStamp} label="заполнена" /> : null}
                <span className={css.coverNumber}>{String(module.number).padStart(2, "0")}</span>
                <span className={css.coverTitle} lang={languageOfText(module.title).code}>
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
