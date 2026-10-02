import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Screen } from "../../app/Screen";
import { installLesson } from "../../content/client";
import type { LessonBlock } from "../../content/course";
import { isTask, lessonDone, lessonTally, testResult } from "../../domain/course";
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
import { Exercise, Explanation, Listening, Reading, Speaking, Writing } from "./blocks";
import { Tick } from "../../shared/Tick";
import { VocabularyList } from "./Vocabulary";
import { TapHint, WordTaps } from "./WordTaps";
import css from "./course.module.css";
import { ExamLine } from "./ExamLine";
import { launchContext } from "../../platform/launch";
import { coverColor } from "../../shared/notebook";

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
      <ExamLine courseId={views[0].module.courseId} />
      <div className={css.shelf}>
        {views.map((view) => {
          const { module } = view;
          const draft = module.status === "draft";
          const classes = [css.cover, draft ? css.draft : "", module.id === current ? css.current : ""].join(" ");
          return (
            <FragmentWithCheckpoint key={module.id} view={view}>
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
/** Метка контрольной точки после модуля; когда точка опубликована — ссылка на неё, после прохождения — с галочкой. */
function FragmentWithCheckpoint({ view, children }: { view: ModuleView; children: React.ReactNode }) {
  const point = view.checkpoint;
  const label = CHECKPOINTS[view.module.number] ?? point?.title;
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

export function ModuleScreen() {
  const { moduleId = "" } = useParams();
  const view = useLiveQuery(
    async () => (await moduleViews()).find((item) => item.module.id === moduleId) ?? null,
    [moduleId],
  );
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
      {lesson.completed ? <Tick className={css.mark} label={passed} /> : <span className={css.gutter}>{gutter}</span>}
      <Link className={css.lessonLink} to={`/course/${module.id}/${lesson.id}`}>
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
        <h2 className={css.title}>Содержание</h2>
        <span className={css.meta}>
          {draft ? `${module.sessions} занятия` : `${done} из ${view.lessons.length} пройдено`}
        </span>
      </div>
      <div className={`${css.block} ${css.marked}`}>
        <span className={css.gutter}>цель</span>
        <p className={css.print}>{module.goal}</p>
      </div>
      {draft ? (
        <p className={`${css.pen} mt-6`}>Модуль готовится: уроки появятся, когда будут проверены.</p>
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
            CHECKPOINTS[module.number] ?? "контрольная точка",
          )}
        </ol>
      ) : null}
      {view.review.length ? (
        <ol className={css.lessons} aria-label="После пробника">
          {view.review.map((lesson, index) => row(lesson, `+${index + 1}`, "занятие пройдено", "после пробника"))}
        </ol>
      ) : null}
      {module.grammar.length ? (
        <div className={`${css.block} ${css.marked} ${css.tocFoot}`}>
          <span className={css.gutter}>грам.</span>
          <p className={`${css.print} ${css.soft}`}>{module.grammar.join(" · ")}</p>
        </div>
      ) : null}
      {problem ? <p className={css.pen}>{problem}</p> : null}
    </>
  );
  const cover = <ModuleCover view={view} open={spread} />;
  return (
    <Screen back={`Модуль ${module.number}`} wide={spread}>
      {spread ? (
        <div className={css.opened}>
          {cover}
          <div className={`${css.page} ${css.contents} notebook`}>{contents}</div>
          <i className={css.staple} style={{ top: "30%" }} aria-hidden="true" />
          <i className={css.staple} style={{ top: "70%" }} aria-hidden="true" />
        </div>
      ) : (
        <>
          {cover}
          <div className={`${css.page} ${css.underFlap} notebook`}>{contents}</div>
        </>
      )}
    </Screen>
  );
}

/**
 * Изнанка обложки с полки: тот же цвет и номер, школьная наклейка и шпаргалка модуля.
 * На развороте шпаргалка видна целиком, на телефоне обложка — клапан над страницей, шпаргалка свёрнута.
 */
function ModuleCover({ view, open }: { view: ModuleView; open: boolean }) {
  const { module } = view;
  const draft = module.status === "draft";
  const name = launchContext().user?.firstName;
  const crib = module.crib ? (
    <>
      <table className={css.cribTable} lang="el">
        <tbody>
          {pairs(module.crib.rows).map((line, i) => (
            <tr key={i}>
              {line.map(([label, value]) => (
                <td key={label + value}>
                  <span className={css.cribLabel}>{label}</span> <b>{value}</b>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {module.crib.note ? <p className={css.cribNote}>{module.crib.note}</p> : null}
    </>
  ) : null;
  const heading = (
    <>
      на обороте обложки <i lang="el">{module.crib?.title}</i>
    </>
  );
  return (
    <section
      className={[open ? css.inside : css.flap, draft ? css.flapDraft : ""].join(" ")}
      style={draft ? undefined : ({ "--cover": coverColor(module.number) } as React.CSSProperties)}
      aria-label={`Обложка модуля ${module.number}`}
    >
      <p className={css.coverNum}>{String(module.number).padStart(2, "0")}</p>
      <dl className={css.sticker}>
        <div>
          <dt lang="el">ΜΑΘΗΜΑ</dt>
          <dd>
            <h1 className={css.stickerTitle} lang="el">
              {module.title}
            </h1>
            <span className={css.stickerSub}>{module.subtitle}</span>
          </dd>
        </div>
        <div>
          <dt lang="el">ΟΝΟΜΑ</dt>
          <dd className={css.stickerInk}>{name}</dd>
        </div>
      </dl>
      {crib ? (
        open ? (
          <div className={css.crib}>
            <p className={css.cribHead}>{heading}</p>
            {crib}
          </div>
        ) : (
          <details className={css.crib}>
            <summary className={css.cribHead}>{heading}</summary>
            {crib}
          </details>
        )
      ) : null}
      {open ? null : (
        <span className={css.flapStaples} aria-hidden="true">
          <i style={{ left: "30%" }} />
          <i style={{ left: "70%" }} />
        </span>
      )}
    </section>
  );
}
const pairs = <T,>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / 2) }, (_, i) => items.slice(i * 2, i * 2 + 2));

export function CourseLessonScreen() {
  const { moduleId = "", lessonId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lesson = useLiveQuery(() => courseLesson(lessonId), [lessonId]);
  const progress = useLiveQuery(() => blockProgressOf(lessonId), [lessonId]);
  const items = useLiveQuery(() => lessonItems(lessonId), [lessonId]);
  const [problem, setProblem] = useState("");
  const [turn, setTurn] = useState<"next" | "prev" | null>(null);
  const spread = useSpread();
  const numbering = useMemo(() => numberBlocks(lesson?.blocks ?? []), [lesson]);
  const pages = useMemo(() => paginate(lesson?.blocks ?? []), [lesson]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const total = pages.length + 1; // последняя страница — итог урока
  const step = spread ? 2 : 1;
  const asked = Number(params.get("p"));
  const resume = progress ? resumePage(pages, (block) => !!progress.get(block.id)?.done) : 0;
  const current = Math.min(Math.max(asked ? asked - 1 : resume < 0 ? pages.length : resume, 0), total - 1);
  const first = spread ? current - (current % 2) : current;
  const go = (target: number, direction: "next" | "prev") => {
    if (target < 0 || target >= total) return;
    setTurn(direction);
    // Листание не копит историю: «Назад» ведёт из урока к модулю, а не по страницам. Без номера в адресе
    // урок открывается на первой странице с невыполненным заданием.
    setParams({ p: String(target + 1) }, { replace: true });
    window.scrollTo({ top: 0 });
  };
  // Страница, на которой урок открылся, фиксируется в адресе: иначе выполненное задание перекидывало бы дальше.
  useEffect(() => {
    if (!asked && progress && lesson) setParams({ p: String(current + 1) }, { replace: true });
  }, [asked, progress, lesson, current, setParams]);
  const next = () => go(first + step, "next");
  const prev = () => go(Math.max(0, first - step), "prev");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
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
  const pending = pages.flatMap((page, index) =>
    page.filter((block) => isTask(block) && !progress.get(block.id)?.done).map((block) => ({ block, index })),
  );

  const renderBlock = (block: LessonBlock) => {
    const row = progress.get(block.id);
    const number = numbering.get(block.id);
    return (
      <section key={block.id} className={css.block} aria-label={blockLabel(block)}>
        {number || row?.done ? (
          <div className={css.blockHead}>
            {number ? <span className={css.gutter}>Задание {number}</span> : null}
            {row?.done ? <Tick className={css.mark} /> : null}
          </div>
        ) : null}
        {block.type === "explanation" ? <Explanation block={block} /> : null}
        {block.type === "vocabulary" ? (
          <>
            <h3 className={css.blockTitle}>{block.title ?? "Слова урока"}</h3>
            <p className={css.instruction}>{items?.length ?? 0} карточек · повторяются по FSRS каждый день</p>
            {items?.length ? <VocabularyList items={items} /> : null}
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
  };
  const summary = (
    <>
      <h2 className={css.title}>Итог</h2>
      {result && complete ? (
        <section className={css.result} aria-label="Итог контрольной">
          <p className={result.passed ? css.score : `${css.score} ${css.failed}`}>
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
        <>
          <p className={`${css.meta} mt-4`} data-testid="lesson-left">
            Осталось заданий: {tally.total - tally.done} из {tally.total} — урок завершается, когда выполнены все.
          </p>
          <ul className={css.pending}>
            {pending.map(({ block, index }) => (
              <li key={block.id}>
                <button type="button" onClick={() => go(index, "prev")}>
                  {numbering.get(block.id) ? `Задание ${numbering.get(block.id)}` : blockLabel(block)} · стр.{" "}
                  {index + 1}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
  const renderPage = (index: number) => (
    <article key={index} className={`${css.page} notebook`} aria-label={`Страница ${index + 1} из ${total}`}>
      {index === 0 ? <TapHint /> : null}
      {index < pages.length ? pages[index].map(renderBlock) : summary}
    </article>
  );
  const shown = spread ? [first, first + 1].filter((index) => index < total) : [current];
  const last = shown[shown.length - 1];
  return (
    <Screen back={lesson.title} wide>
      <WordTaps marks={lesson.marks} cards={lesson.cards} page={first}>
        <div className={css.frame}>
          <div
            key={first}
            className={`${css.sheet} ${spread ? css.spread : ""} ${turn === "next" ? css.turnNext : turn === "prev" ? css.turnPrev : ""}`}
            onTouchStart={(event) => {
              const target = event.target as HTMLElement;
              const point = event.touches[0];
              touch.current =
                target.closest("input, textarea") || scrollsSideways(target)
                  ? null
                  : { x: point.clientX, y: point.clientY };
            }}
            onTouchEnd={(event) => {
              const start = touch.current;
              touch.current = null;
              if (!start) return;
              const point = event.changedTouches[0];
              const dx = point.clientX - start.x;
              const dy = point.clientY - start.y;
              if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
              if (dx < 0) next();
              else prev();
            }}
          >
            {shown.map(renderPage)}
          </div>
        </div>
      </WordTaps>
      <nav className={css.pager} aria-label="Страницы урока">
        <Button
          variant="ghost"
          size="md"
          className="h-full w-auto text-primary"
          onClick={prev}
          disabled={first === 0}
          aria-label="Предыдущая страница"
        >
          <ChevronLeft />
        </Button>
        <span className={css.pageCount} data-testid="page-count">
          <span>
            {shown.length > 1 ? `стр. ${first + 1}–${last + 1}` : `стр. ${current + 1}`} из {total}
          </span>
          <span className={css.pageTasks}>
            заданий {tally.done} из {tally.total}
          </span>
        </span>
        <Button size="md" className="h-full w-auto" onClick={next} disabled={last >= total - 1}>
          {last + 1 >= total - 1 ? "К итогу" : "Далее"}
          <ChevronRight data-icon="inline-end" />
        </Button>
      </nav>
    </Screen>
  );
}

/** Страницы урока: каждый блок — страница, а задания к тексту или записи — на странице самого текста. */
function paginate(blocks: LessonBlock[]) {
  const pages: LessonBlock[][] = [];
  const home = new Map<string, number>();
  for (const block of blocks) {
    const about = block.type === "exercise" ? block.about : undefined;
    if (about && home.has(about)) {
      pages[home.get(about)!].push(block);
      continue;
    }
    pages.push([block]);
    if (block.type === "reading" || block.type === "listening") home.set(block.id, pages.length - 1);
  }
  return pages;
}
/** Первая страница с невыполненным заданием, но с теорией и словами перед ним: иначе новый урок открывался бы на упражнении. */
function resumePage(pages: LessonBlock[][], done: (block: LessonBlock) => boolean) {
  const hasTask = (page: LessonBlock[]) => page.some(isTask);
  let index = pages.findIndex((page) => page.some((block) => isTask(block) && !done(block)));
  if (index < 0) return index;
  while (index > 0 && !hasTask(pages[index - 1])) index--;
  return index;
}
/** Свайп внутри прокручиваемой вбок таблицы листает таблицу, а не страницу. */
function scrollsSideways(target: HTMLElement) {
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth && /(auto|scroll)/.test(getComputedStyle(node).overflowX)) return true;
  }
  return false;
}
/** Разворот из двух страниц — когда окно широкое, как у Telegram Desktop на весь экран. */
const SPREAD = "(min-width: 1024px)";
function useSpread() {
  const [wide, setWide] = useState(() => window.matchMedia(SPREAD).matches);
  useEffect(() => {
    const query = window.matchMedia(SPREAD);
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/** Номера заданий — у блоков, которые делают, а не читают. */
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
