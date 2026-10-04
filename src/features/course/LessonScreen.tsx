import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Screen } from "../../app/Screen";
import type { LessonBlock } from "../../content/course";
import { lessonTally } from "../../domain/course";
import { blockProgressOf, completeLesson, courseLesson, saveBlockProgress } from "../../storage/course";
import { lessonItems } from "../../storage/queries";
import { startSession } from "../learning/session-actions";
import { Exercise, Explanation, Listening, Reading, Speaking, Writing } from "./blocks";
import { Tick } from "../../shared/Tick";
import { useSpread } from "../../shared/spread";
import { VocabularyList } from "./Vocabulary";
import { TapHint, WordTaps } from "./WordTaps";
import { LessonSummary } from "./LessonSummary";
import { blockLabel, numberBlocks, paginate, resumePage } from "./paginate";
import { usePager } from "./usePager";
import base from "./course.module.css";
import css from "./lesson.module.css";

export function CourseLessonScreen() {
  const { moduleId = "", lessonId = "" } = useParams();
  const navigate = useNavigate();
  const lesson = useLiveQuery(() => courseLesson(lessonId), [lessonId]);
  const progress = useLiveQuery(() => blockProgressOf(lessonId), [lessonId]);
  const items = useLiveQuery(() => lessonItems(lessonId), [lessonId]);
  const [problem, setProblem] = useState("");
  const spread = useSpread();
  const numbering = useMemo(() => numberBlocks(lesson?.blocks ?? []), [lesson]);
  const pages = useMemo(() => paginate(lesson?.blocks ?? []), [lesson]);
  const total = pages.length + 1; // последняя страница — итог урока
  const resume = progress ? resumePage(pages, (block) => !!progress.get(block.id)?.done) : 0;
  const { current, first, turn, go, next, prev, swipe } = usePager({
    total,
    opening: resume < 0 ? pages.length : resume,
    ready: !!progress && !!lesson,
    spread,
  });
  if (lesson === undefined || progress === undefined) return <Screen back="Урок" />;
  if (lesson === null) return <Navigate to={`/course/${moduleId}`} replace />;
  const save = (blockId: string) => (patch: Parameters<typeof saveBlockProgress>[2]) =>
    saveBlockProgress(lessonId, blockId, patch);
  const tally = lessonTally(lesson.blocks, progress);
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
      void navigate(`/course/${moduleId}`, { replace: true });
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const renderBlock = (block: LessonBlock) => {
    const row = progress.get(block.id);
    const number = numbering.get(block.id);
    return (
      <section key={block.id} className={css.block} aria-label={blockLabel(block)}>
        {number || row?.done ? (
          <div className={base.blockHead}>
            {number ? <span className={base.gutter}>Задание {number}</span> : null}
            {row?.done ? <Tick className={base.mark} /> : null}
          </div>
        ) : null}
        {block.type === "explanation" ? <Explanation block={block} /> : null}
        {block.type === "vocabulary" ? (
          <>
            <h3 className={base.blockTitle}>{block.title ?? "Слова урока"}</h3>
            <p className={base.instruction}>{items?.length ?? 0} карточек · повторяются по FSRS каждый день</p>
            {items?.length ? <VocabularyList items={items} /> : null}
            <div className={base.actions}>
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
  const renderPage = (index: number) => (
    <article key={index} className={css.page} aria-label={`Страница ${index + 1} из ${total}`}>
      {index === 0 ? <TapHint /> : null}
      {index < pages.length ? (
        pages[index].map(renderBlock)
      ) : (
        <LessonSummary
          lesson={lesson}
          progress={progress}
          pages={pages}
          numbering={numbering}
          problem={problem}
          finish={finish}
          go={go}
        />
      )}
    </article>
  );
  const shown = spread ? [first, first + 1].filter((index) => index < total) : [current];
  const last = shown[shown.length - 1];
  return (
    <Screen back="" wide paper>
      <h1 className="sr-only">{lesson.title}</h1>
      <WordTaps marks={lesson.marks} cards={lesson.cards} page={first}>
        <div className={css.frame}>
          <div
            key={first}
            className={`${css.sheet} ${spread ? css.spread : ""} ${turn === "next" ? css.turnNext : turn === "prev" ? css.turnPrev : ""}`}
            {...swipe}
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
