import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Screen } from "../../app/Screen";
import type { LessonBlock } from "../../content/course";
import { lessonDone, lessonTally } from "../../domain/course";
import {
  lessonMistakes,
  blockProgressOf,
  completeIfDone,
  courseLesson,
  nextCourseLesson,
  saveBlockProgress,
} from "../../storage/course";
import { lessonCourses } from "../../storage/courses";
import { courseReadings } from "../../storage/readings";
import { settledFor } from "./settled";
import { db } from "../../storage/db";
import { useFollowCourse } from "../../shared/courses";
import { lessonItems } from "../../storage/queries";
import { sessionPath, startSession } from "../learning/session-actions";
import { Exercise, Explanation, Listening, Reading, Speaking, Writing } from "./blocks";
import { Tick } from "../../shared/Tick";
import { cx } from "../../shared/cx";
import { ProfileContext, useLessonProfile } from "../../shared/language";
import { useSpread } from "../../shared/media";
import nb from "../../shared/notebook.module.css";
import { VocabularyList } from "./Vocabulary";
import { TapHint, WordTaps } from "./WordTaps";
import { LessonDownload } from "./LessonDownload";
import { LessonReview, LessonSummary } from "./LessonSummary";
import { blockLabel, numberBlocks, paginate, resumePage } from "./paginate";
import { usePager } from "./usePager";
import base from "./course.module.css";
import css from "./lesson.module.css";

export function CourseLessonScreen() {
  const { moduleId = "", lessonId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const lesson = useLiveQuery(() => courseLesson(lessonId), [lessonId]);
  const progress = useLiveQuery(() => blockProgressOf(lessonId), [lessonId]);
  const items = useLiveQuery(() => lessonItems(lessonId), [lessonId]);
  const mistakes = useLiveQuery(() => lessonMistakes(lessonId), [lessonId]) ?? 0;
  const finished = !!lesson?.lesson?.completed;
  const lessonCourse = useLiveQuery(async () => (await lessonCourses([lessonId])).get(lessonId) ?? null, [lessonId]);
  useFollowCourse(lessonCourse ?? undefined);
  // Итог не показывает кнопки, пока не известны следующий шаг и, если шага нет, первый непрочитанный текст: они бы сдвигались.
  const live = useLiveQuery(async () => {
    if (!finished || lessonCourse === undefined) return undefined;
    const step = lessonCourse ? await nextCourseLesson(lessonCourse) : null;
    const reading = step || !lessonCourse ? null : ((await courseReadings(lessonCourse)).unread[0] ?? null);
    return { lessonId, step, reading };
  }, [finished, lessonCourse, lessonId]);
  // При смене зависимостей хук держит прежний результат: итог другого урока не показывается как свой.
  const ending = settledFor(live, lessonId);
  const next = ending === undefined ? undefined : ending.step;
  const reading = ending?.reading ?? null;
  const passShare = useLiveQuery(
    async () => (lessonCourse ? (await db.courses.get(lessonCourse))?.passShare : undefined),
    [lessonCourse],
  );
  const [problem, setProblem] = useState("");
  // Кнопка тренировки есть в трёх местах, поэтому повторное нажатие отсекается здесь, а не их состоянием.
  const starting = useRef(false);
  const profile = useLessonProfile(lessonId);
  const spread = useSpread();
  const numbering = useMemo(() => numberBlocks(lesson?.blocks ?? []), [lesson]);
  const pages = useMemo(() => paginate(lesson?.blocks ?? []), [lesson]);
  const total = pages.length + 1; // последняя страница — итог урока
  const resume = progress ? resumePage(pages, (block) => !!progress.get(block.id)?.done) : 0;
  const {
    current,
    first,
    turn,
    go,
    next: turnNext,
    prev,
    swipe,
  } = usePager({
    total,
    opening: resume < 0 ? pages.length : resume,
    ready: !!progress && !!lesson,
    spread,
  });
  // Задания выполнены раньше, чем урок стал завершаться сам, — отмечаем при открытии.
  const pendingCompletion = !!lesson && !!progress && !finished && lessonDone(lesson.blocks, progress);
  useEffect(() => {
    if (pendingCompletion) void completeIfDone(lessonId);
  }, [pendingCompletion, lessonId]);
  if (lesson === undefined || progress === undefined) return <Screen back="Урок" />;
  if (lesson === null) return <LessonDownload lessonId={lessonId} moduleId={moduleId} />;
  const save = (blockId: string) => (patch: Parameters<typeof saveBlockProgress>[2]) =>
    saveBlockProgress(lessonId, blockId, patch);
  const tally = lessonTally(lesson.blocks, progress);
  const answered = (target: string) =>
    lesson.blocks.some((block) => block.type === "exercise" && block.about === target && progress.get(block.id)?.done);
  const practiceWords = async () => {
    if (starting.current) return;
    starting.current = true;
    setProblem("");
    try {
      // Курс урока может ещё читаться: без него в варианты попали бы слова всех курсов.
      const courseId = lessonCourse ?? (await lessonCourses([lessonId])).get(lessonId);
      const created =
        items?.length && courseId
          ? await startSession(new Date(), { refs: items.map((item) => item.ref), mode: "practice", courseId })
          : null;
      if (!created) return setProblem("В уроке нет доступных карточек.");
      void navigate(await sessionPath(created));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Не удалось начать тренировку.");
    } finally {
      starting.current = false;
    }
  };
  const fromModule = !!(location.state as { fromModule?: boolean } | null)?.fromModule;
  const toModule = () => {
    // Открыт со страницы модуля — возвращаемся на неё же, иначе модуль окажется в истории дважды.
    if (fromModule) void navigate(-1);
    else void navigate(`/course/${moduleId}`, { replace: true });
  };
  const openNext = () => {
    if (!next) return;
    const same = next.module.id === moduleId;
    void navigate(`/course/${next.module.id}/${next.lesson.id}`, {
      replace: true,
      state: same && fromModule ? location.state : null,
    });
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
  // Итог на левой странице разворота — справа карточки урока, иначе страница пустует.
  const review = spread && first === total - 1 && finished && !!items?.length;
  const renderPage = (index: number) => (
    <article key={index} className={css.page} aria-label={`Страница ${index + 1} из ${total}`}>
      {index === 0 ? <TapHint /> : null}
      {index < pages.length ? (
        pages[index].map(renderBlock)
      ) : index === pages.length ? (
        <LessonSummary
          lesson={lesson}
          progress={progress}
          passShare={passShare}
          pages={pages}
          numbering={numbering}
          items={items ?? []}
          mistakes={mistakes}
          next={next === undefined ? undefined : (next?.lesson ?? null)}
          reading={reading}
          withList={review}
          problem={problem}
          practice={() => void practiceWords()}
          go={go}
          openNext={openNext}
          openReading={() => reading && void navigate(`/course/${reading.moduleId}/read/${reading.reading.id}`)}
          toModule={toModule}
        />
      ) : (
        <LessonReview items={items ?? []} practice={() => void practiceWords()} />
      )}
    </article>
  );
  const shown = spread ? [first, first + 1].filter((index) => index < total || (review && index === total)) : [current];
  const last = Math.min(shown[shown.length - 1], total - 1);
  const atEnd = last >= total - 1;
  return (
    <ProfileContext value={profile}>
      <Screen back="" wide paper>
        <h1 className="sr-only">{lesson.title}</h1>
        <WordTaps marks={lesson.marks} cards={lesson.cards} page={first}>
          <div className={cx(css.frame, spread && nb.spine)}>
            <div
              key={first}
              className={cx(
                css.sheet,
                spread && nb.spread,
                spread && css.spread,
                turn === "next" ? css.turnNext : turn === "prev" && css.turnPrev,
              )}
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
              {last > first ? `стр. ${first + 1}–${last + 1}` : `стр. ${current + 1}`} из {total}
            </span>
            <span className={css.pageTasks}>
              заданий {tally.done} из {tally.total}
            </span>
          </span>
          {atEnd && next ? (
            <Button size="md" className="h-full w-auto" onClick={openNext}>
              Следующий урок
              <ChevronRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button size="md" className="h-full w-auto" onClick={turnNext} disabled={atEnd}>
              {last + 1 >= total - 1 ? "К итогу" : "Далее"}
              <ChevronRight data-icon="inline-end" />
            </Button>
          )}
        </nav>
      </Screen>
    </ProfileContext>
  );
}
