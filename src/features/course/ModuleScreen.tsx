import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Screen } from "../../app/Screen";
import { installLesson } from "../../content/client";
import { moduleViews, type ModuleView } from "../../storage/course";
import { db } from "../../storage/db";
import { Tick } from "../../shared/Tick";
import { useSpread } from "../../shared/media";
import { checkpointLabels } from "./checkpoints";
import { ModuleCover } from "./ModuleCover";
import ui from "../../shared/ui.module.css";
import base from "./course.module.css";
import css from "./module-screen.module.css";

const FROM_MODULE = { fromModule: true };

export function ModuleScreen() {
  const { moduleId = "" } = useParams();
  const view = useLiveQuery(
    async () => (await moduleViews()).find((item) => item.module.id === moduleId) ?? null,
    [moduleId],
  );
  const courseId = view?.module.courseId;
  const course = useLiveQuery(async () => (courseId ? await db.courses.get(courseId) : undefined), [courseId]);
  const spread = useSpread();
  const [problem, setProblem] = useState("");
  // Уроки опубликованного модуля скачиваются при открытии: без пакета урок не пройти.
  useEffect(() => {
    if (!view) return;
    for (const lesson of [...view.lessons, ...(view.checkpoint ? [view.checkpoint] : []), ...view.review])
      if (!lesson.installed)
        installLesson(lesson.id).catch(() =>
          setProblem("Не удалось скачать уроки модуля. Проверьте сеть и откройте модуль снова."),
        );
  }, [view]);
  if (view === undefined) return <Screen back="Модуль" />;
  if (view === null) return <Navigate to="/course" replace />;
  const { module } = view;
  const draft = module.status === "draft";
  const done = view.lessons.filter((lesson) => lesson.completed).length;
  const next = [...view.lessons, ...(view.checkpoint ? [view.checkpoint] : []), ...view.review].find(
    (lesson) => !lesson.completed,
  )?.id;
  const row = (lesson: ModuleView["lessons"][number], gutter: string, passed: string, kind?: string) => (
    <li key={lesson.id} className={lesson.id === next ? css.now : undefined}>
      {lesson.completed ? <Tick className={base.mark} label={passed} /> : <span className={base.gutter}>{gutter}</span>}
      <Link className={css.lessonLink} to={`/course/${module.id}/${lesson.id}`} state={FROM_MODULE}>
        <span className={css.tocLine}>
          <h3 className={css.blockTitle}>{lesson.title}</h3>
          <span className={css.dots} aria-hidden="true" />
          {lesson.installed ? (
            <span className={lesson.completed ? `${css.tocCount} ${css.tocDone}` : css.tocCount}>
              <span className="sr-only">заданий выполнено </span>
              {lesson.tally.done} / {lesson.tally.total}
            </span>
          ) : null}
        </span>
        {kind || lesson.id === next || !lesson.installed ? (
          <span className={css.meta}>
            {[kind, lesson.id === next ? "следующий шаг" : "", lesson.installed ? "" : "скачивается…"]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
      </Link>
    </li>
  );
  const contents = (
    <>
      <div className={css.tocHead}>
        <h2 className={base.title}>Содержание</h2>
        <span className={base.meta}>
          {draft ? `${module.sessions} занятия` : `${done} из ${view.lessons.length} пройдено`}
        </span>
      </div>
      <div className={`${base.block} ${base.marked}`}>
        <span className={base.gutter}>цель</span>
        <p className={base.print}>{module.goal}</p>
      </div>
      {draft ? (
        <p className={`${ui.note} mt-6`}>Модуль готовится: уроки появятся, когда будут проверены.</p>
      ) : (
        <ol className={css.lessons}>
          {view.lessons.map((lesson, index) =>
            row(lesson, `${index + 1}.`, "урок пройден", lesson.kind === "test" ? "контрольная" : undefined),
          )}
        </ol>
      )}
      {view.checkpoint ? (
        <ol className={`${css.lessons} ${css.tocBreak}`} aria-label="Контрольная точка">
          {row(
            view.checkpoint,
            "точка",
            "контрольная точка пройдена",
            checkpointLabels(course?.calendar)[module.number] ?? "контрольная точка",
          )}
        </ol>
      ) : null}
      {view.review.length ? (
        <ol className={css.lessons} aria-label="После пробника">
          {view.review.map((lesson, index) => row(lesson, `+${index + 1}`, "занятие пройдено", "после пробника"))}
        </ol>
      ) : null}
      {module.grammar.length ? (
        <div className={`${base.block} ${base.marked} ${css.tocFoot}`}>
          <span className={base.gutter}>грам.</span>
          <p className={`${base.print} ${base.soft}`}>{module.grammar.join(" · ")}</p>
        </div>
      ) : null}
      {problem ? (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
  const cover = <ModuleCover view={view} open={spread} />;
  return (
    <Screen back={`Модуль ${module.number}`} wide={spread}>
      {spread ? (
        <div className={css.opened}>
          {cover}
          <div className={`${base.page} ${css.contents} notebook`}>{contents}</div>
          <i className={css.staple} style={{ top: "30%" }} aria-hidden="true" />
          <i className={css.staple} style={{ top: "70%" }} aria-hidden="true" />
        </div>
      ) : (
        <>
          {cover}
          <div className={`${base.page} ${css.underFlap} notebook`}>{contents}</div>
        </>
      )}
    </Screen>
  );
}
