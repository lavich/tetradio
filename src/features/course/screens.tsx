import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Screen } from "../../app/Screen";
import { installLesson } from "../../content/client";
import type { LessonBlock } from "../../content/course";
import { lessonDone, lessonTally, testResult } from "../../domain/course";
import { SKILL_LABEL } from "../../content/course";
import {
  blockProgressOf,
  completeLesson,
  courseLesson,
  moduleViews,
  saveBlockProgress,
  type ModuleView,
} from "../../storage/course";
import { lessonItems } from "../../storage/queries";
import { startSession } from "../learning/session-actions";
import { Exercise, Explanation, Listening, Reading, Speaking, Tick, Writing } from "./blocks";
import css from "./course.module.css";

/** Цвета обложек: греческие школьные тетради яркие; цвет повторяется по номеру модуля. */
const COVERS = ["#2f6d4f", "#b8452b", "#2c4f9e", "#b8871a", "#7b3f74", "#1f6f7a"];
export const coverColor = (number: number) => COVERS[(number - 1) % COVERS.length];
/** Контрольные точки программы (docs/curriculum.md): после каких модулей стоят контрольная и пробники. */
const CHECKPOINTS: Record<number, string> = {
  8: "Контрольная A1 · декабрь",
  15: "Пробник M1 · февраль",
  20: "Пробник M2 · март",
  24: "Пробник M3 · апрель",
};

function coverLabel(view: ModuleView) {
  if (view.module.status === "draft") return "Готовится";
  if (view.completed) return "Заполнена";
  const done = view.lessons.filter((lesson) => lesson.completed).length;
  return done ? `Урок ${done + 1} из ${view.lessons.length}` : "Открыта";
}

/** Полка курса; без модулей в каталоге (словарный курс) — прежний список уроков. */
export function CourseScreen() {
  const views = useLiveQuery(() => moduleViews(), []);
  if (views === undefined) return <Screen />;
  if (!views.length) return <Navigate to="/lessons" replace />;
  const filled = views.filter((view) => view.completed).length;
  const current = views.find((view) => view.module.status === "published" && !view.completed)?.module.id;
  return (
    <Screen>
      <div className="flex items-baseline justify-between gap-3">
        <h1>Полка</h1>
        <span className={css.meta}>
          {filled} из {views.length} заполнено
        </span>
      </div>
      <div className={css.shelf}>
        {views.map((view) => {
          const { module } = view;
          const draft = module.status === "draft";
          const classes = [css.cover, draft ? css.draft : "", module.id === current ? css.current : ""].join(" ");
          return (
            <FragmentWithCheckpoint key={module.id} number={module.number}>
              <Link
                to={`/course/${module.id}`}
                className={classes}
                style={draft ? undefined : { background: coverColor(module.number) }}
                aria-label={`Модуль ${module.number}: ${module.subtitle}. ${coverLabel(view)}`}
              >
                {view.completed ? <Tick className={css.coverStamp} label="заполнена" /> : null}
                <span className={css.coverNumber}>{String(module.number).padStart(2, "0")}</span>
                <span className={css.coverTitle} lang="el">
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
function FragmentWithCheckpoint({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <>
      {children}
      {CHECKPOINTS[number] ? <div className={css.checkpoint}>{CHECKPOINTS[number]}</div> : null}
    </>
  );
}

export function ModuleScreen() {
  const { moduleId = "" } = useParams();
  const view = useLiveQuery(
    async () => (await moduleViews()).find((item) => item.module.id === moduleId) ?? null,
    [moduleId],
  );
  const [problem, setProblem] = useState("");
  // Уроки опубликованного модуля скачиваются при открытии: без пакета урок не пройти.
  useEffect(() => {
    if (!view) return;
    for (const lesson of view.lessons)
      if (!lesson.installed)
        installLesson(lesson.id).catch(() =>
          setProblem("Не удалось скачать уроки модуля. Проверьте сеть и откройте модуль снова."),
        );
  }, [view]);
  if (view === undefined) return <Screen back="Модуль" />;
  if (view === null) return <Navigate to="/course" replace />;
  const { module } = view;
  return (
    <Screen back={`Модуль ${module.number}`}>
      <div className={css.page + " notebook"}>
        <p className={css.meta}>
          Модуль {String(module.number).padStart(2, "0")} · {module.sessions} занятия
        </p>
        <h1 className={css.title} lang="el">
          {module.title}
        </h1>
        <p className={css.print}>{module.subtitle}</p>
        <div className={css.block}>
          <span className={css.gutter}>цель</span>
          <p className={css.print}>{module.goal}</p>
        </div>
        {module.grammar.length ? (
          <div className={css.block}>
            <span className={css.gutter}>грам.</span>
            <p className={css.print}>{module.grammar.join(" · ")}</p>
          </div>
        ) : null}
        {module.status === "draft" ? (
          <p className={`${css.pen} mt-6`}>Модуль готовится: уроки появятся, когда будут проверены.</p>
        ) : (
          <ol className={css.lessons}>
            {view.lessons.map((lesson, index) => (
              <li key={lesson.id}>
                {lesson.completed ? (
                  <Tick className={css.mark} label="урок пройден" />
                ) : (
                  <span className={css.gutter}>{index + 1}.</span>
                )}
                <Link className={css.lessonLink} to={`/course/${module.id}/${lesson.id}`}>
                  <h3 className={css.blockTitle}>{lesson.title}</h3>
                  <span className={css.meta}>
                    {lesson.kind === "test" ? "контрольная · " : ""}
                    {lesson.installed
                      ? `заданий выполнено ${lesson.tally.done} из ${lesson.tally.total}`
                      : "скачивается…"}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
        {problem ? <p className={css.pen}>{problem}</p> : null}
      </div>
    </Screen>
  );
}

export function CourseLessonScreen() {
  const { moduleId = "", lessonId = "" } = useParams();
  const navigate = useNavigate();
  const lesson = useLiveQuery(() => courseLesson(lessonId), [lessonId]);
  const progress = useLiveQuery(() => blockProgressOf(lessonId), [lessonId]);
  const items = useLiveQuery(() => lessonItems(lessonId), [lessonId]);
  const [problem, setProblem] = useState("");
  const numbering = useMemo(() => numberBlocks(lesson?.blocks ?? []), [lesson]);
  if (lesson === undefined || progress === undefined) return <Screen back="Урок" />;
  if (lesson === null) return <Navigate to={`/course/${moduleId}`} replace />;
  const save = (blockId: string) => (patch: Parameters<typeof saveBlockProgress>[2]) =>
    saveBlockProgress(lessonId, blockId, patch);
  const complete = lessonDone(lesson.blocks, progress);
  const tally = lessonTally(lesson.blocks, progress);
  const finished = lesson.lesson?.status === "completed";
  const answered = (target: string) =>
    lesson.blocks.some((block) => block.type === "exercise" && block.about === target && progress.get(block.id)?.done);
  const practiceWords = async () => {
    setProblem("");
    const created = items?.length
      ? await startSession(new Date(), { refs: items.map((item) => item.ref), mode: "practice" })
      : null;
    if (!created) return setProblem("В уроке нет доступных карточек.");
    void navigate("/session");
  };
  const finish = async () => {
    try {
      await completeLesson(lessonId);
      toast.success("Урок пройден");
      void navigate(`/course/${moduleId}`);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  const result = lesson.kind === "test" ? testResult(lesson.blocks, progress) : null;
  return (
    <Screen back={lesson.kind === "test" ? "Контрольная" : "Урок"}>
      <article className={css.page + " notebook"}>
        <p className={css.meta}>{lesson.kind === "test" ? "Контрольная модуля" : "Урок модуля"}</p>
        <h1 className={css.title}>{lesson.title}</h1>
        {lesson.blocks.map((block) => {
          const row = progress.get(block.id);
          return (
            <section key={block.id} className={css.block} aria-label={blockLabel(block)}>
              {row?.done ? (
                <Tick className={css.mark} />
              ) : numbering.get(block.id) ? (
                <span className={css.gutter}>{numbering.get(block.id)}.</span>
              ) : null}
              {block.type === "explanation" ? <Explanation block={block} /> : null}
              {block.type === "vocabulary" ? (
                <>
                  <h3 className={css.blockTitle}>{block.title ?? "Слова урока"}</h3>
                  <p className={css.instruction}>{items?.length ?? 0} карточек · повторяются по FSRS каждый день</p>
                  <div className={css.actions}>
                    <Button variant="soft" size="md" onClick={() => void practiceWords()}>
                      Тренировать слова урока
                    </Button>
                  </div>
                </>
              ) : null}
              {block.type === "reading" ? <Reading block={block} /> : null}
              {block.type === "listening" ? <Listening block={block} revealed={answered(block.id)} /> : null}
              {block.type === "exercise" ? <Exercise block={block} progress={row} save={save(block.id)} /> : null}
              {block.type === "writing" ? <Writing block={block} progress={row} save={save(block.id)} /> : null}
              {block.type === "speaking" ? <Speaking block={block} progress={row} save={save(block.id)} /> : null}
            </section>
          );
        })}
        {result && complete ? (
          <section className={css.result} aria-label="Итог контрольной">
            <p className={css.score}>
              Итог: {result.correct} из {result.total} ({Math.round(result.share * 100)} %) —{" "}
              {result.passed ? "порог 60 % пройден" : "ниже порога 60 %"}
            </p>
            {result.skills.map((skill) => (
              <p key={skill.skill} className={css.print}>
                {SKILL_LABEL[skill.skill]}: {skill.correct} из {skill.total} — {skill.passed ? "сдано" : "не сдано"}
              </p>
            ))}
            <p className={css.meta}>Письмо и речь — самопроверка, в итог не входят.</p>
          </section>
        ) : null}
        {problem ? <p className={css.pen}>{problem}</p> : null}
        {finished ? (
          <p className={`${css.score} mt-8`}>Урок пройден</p>
        ) : complete ? (
          <div className={css.dock}>
            <Button size="xl" onClick={() => void finish()}>
              Завершить урок
            </Button>
          </div>
        ) : (
          <p className={`${css.meta} mt-8`} data-testid="lesson-left">
            Осталось заданий: {tally.total - tally.done} из {tally.total} — урок завершается, когда выполнены все.
          </p>
        )}
      </article>
    </Screen>
  );
}

/** Номера на полях — у блоков, которые делают, а не читают. */
function numberBlocks(blocks: LessonBlock[]) {
  const numbers = new Map<string, number>();
  let n = 0;
  for (const block of blocks)
    if (block.type === "exercise" || block.type === "writing" || block.type === "speaking") numbers.set(block.id, ++n);
  return numbers;
}
function blockLabel(block: LessonBlock) {
  switch (block.type) {
    case "explanation":
      return block.title ?? "Объяснение";
    case "vocabulary":
      return "Слова урока";
    case "reading":
      return `Чтение: ${block.title}`;
    case "listening":
      return `Аудирование: ${block.title}`;
    case "exercise":
      return block.title ?? block.instruction;
    case "writing":
      return "Письмо";
    case "speaking":
      return "Речь";
  }
}
