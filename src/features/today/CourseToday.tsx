import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { languageOfText } from "../../domain/language";
import { deviceTimezone, localDay, mondayOf, type DailyPlan } from "../../domain/learning";
import type { Session } from "../../domain/types";
import { useAction } from "../../shared/action";
import { cx } from "../../shared/cx";
import { lessonIn, withCount } from "../../shared/format";
import { useCourseProfile } from "../../shared/language";
import { coverColor, pageDate } from "../../shared/notebook";
import { useSpread } from "../../shared/media";
import nb from "../../shared/notebook.module.css";
import { Tick } from "../../shared/Tick";
import { WEEK_PLAN, WeekStrip } from "../../shared/WeekStrip";
import { lessonDays, moduleViews, reviewedOn, type ModuleLessonView, type ModuleView } from "../../storage/course";
import { dexieSource } from "../../storage/queries";
import { ExamLine } from "../course/ExamLine";
import { startSession } from "../learning/session-actions";
import { DayNotes } from "./DayNotes";
import css from "./today.module.css";

/**
 * «Сегодня» курса — страница тетради с двумя ритмами: повторение каждый день, урок 2–3 раза в неделю.
 * Главная кнопка одна: у повторения, пока оно ждёт, потом у урока. На широком окне справа — тетрадь модуля.
 */
export function CourseToday({ plan, now, unfinished }: { plan: DailyPlan; now: Date; unfinished: Session | null }) {
  const spread = useSpread();
  const today = localDay(now, deviceTimezone());
  const monday = mondayOf(today);
  const views = useLiveQuery(() => moduleViews(), []);
  const reviewed = useLiveQuery(() => reviewedOn(today), [today]);
  const week = useLiveQuery(() => lessonDays(monday, deviceTimezone()), [monday, deviceTimezone()]);
  const profile = useCourseProfile(views?.[0]?.module.courseId);

  const lessons = (views ?? []).flatMap((view) => [
    ...view.lessons,
    ...(view.checkpoint ? [view.checkpoint] : []),
    ...view.review,
  ]);
  const last = lessons.filter((lesson) => lesson.completed).at(-1);
  const finished = !!lessons.length && lessons.every((lesson) => lesson.completed);
  const next = nextStep(views ?? []);
  const due = plan.newRefs.length + plan.reviews.length;
  const reviewFirst = !!unfinished || due > 0;
  if (!views || reviewed === undefined || !week) return <div aria-busy="true" aria-label="План дня загружается" />;

  const page = (
    <section className={cx(nb.page, css.page)}>
      <p className={nb.date} lang={profile.code}>
        {pageDate(today, profile)}
      </p>
      <h1 className="sr-only" data-testid="today-title">
        Сегодня
      </h1>
      <Review
        plan={plan}
        now={now}
        unfinished={unfinished}
        reviewed={reviewed ?? 0}
        last={last}
        primary={reviewFirst}
      />
      <DayNotes plan={plan} />
      {finished ? (
        <p className={css.finished} data-testid="course-finished">
          Все модули и пробники пройдены. До экзамена — повторение карточек и слабый навык по итогам M3.
        </p>
      ) : next ? (
        <LessonNext
          view={next.view}
          lesson={next.lesson}
          primary={!reviewFirst}
          week={spread ? undefined : (week?.length ?? 0)}
        />
      ) : null}
      {views?.[0] && (
        <div className={css.exam}>
          <ExamLine courseId={views[0].module.courseId} />
        </div>
      )}
    </section>
  );
  if (!spread || !next) return page;
  return (
    <div className={cx(nb.spread, css.spread)}>
      {page}
      <ModulePage view={next.view} current={next.lesson.id} week={week ?? []} monday={monday} today={today} />
    </div>
  );
}

function nextStep(views: ModuleView[]): { view: ModuleView; lesson: ModuleLessonView } | null {
  for (const view of views) {
    if (view.module.status !== "published") continue;
    const lesson =
      view.lessons.find((item) => !item.completed) ??
      (view.checkpoint && !view.checkpoint.completed ? view.checkpoint : undefined) ??
      view.review.find((item) => !item.completed);
    if (lesson) return { view, lesson };
  }
  return null;
}

function Review({
  plan,
  now,
  unfinished,
  reviewed,
  last,
  primary,
}: {
  plan: DailyPlan;
  now: Date;
  unfinished: Session | null;
  reviewed: number;
  last?: ModuleLessonView;
  primary: boolean;
}) {
  const navigate = useNavigate();
  const { busy, problem, setProblem, run } = useAction("Не удалось начать повторение");
  const fresh = plan.newRefs.length;
  const reviews = plan.reviews.length;
  const review = () =>
    run(async () => {
      if (unfinished) return navigate("/session");
      if (!(await startSession(now))) return setProblem("На сегодня карточек нет.");
      void navigate("/session");
    });
  // Тренировка не сдвигает интервалы: навык фиксируется, расписание повторений остаётся прежним.
  const practice = () =>
    run(async () => {
      if (!last) return;
      const refs = await dexieSource().lessonRefs(last.id);
      const session = refs.length ? await startSession(now, { refs, mode: "practice" }) : null;
      if (!session) return setProblem("В уроке нет карточек для тренировки.");
      void navigate("/session");
    });
  const error = problem && (
    <p className={css.problem} role="alert">
      {problem}
    </p>
  );

  if (unfinished || fresh || reviews)
    return (
      <div className={css.sheet}>
        <div className={css.sheetHead}>
          <span className={css.count}>{unfinished ? unfinished.items.length - unfinished.index : fresh + reviews}</span>
          <div className="min-w-0">
            <h2 className={css.sheetTitle}>{unfinished ? "Повторение не закончено" : "Повторение"}</h2>
            {!unfinished && (
              <p className={nb.meta} data-testid="cards-today">
                {[
                  fresh && withCount(fresh, ["новая", "новые", "новых"]),
                  reviews && withCount(reviews, ["повторение", "повторения", "повторений"]),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>
        <Button size="md" variant={primary ? "default" : "soft"} onClick={review} disabled={busy}>
          {unfinished ? "Продолжить повторение" : "Повторить карточки"}
          <ArrowRight data-icon="inline-end" />
        </Button>
        {error}
      </div>
    );

  return (
    <div className={cx(css.sheet, css.trace)}>
      <div className={css.sheetHead}>
        {reviewed ? <Tick className={css.bigTick} label="повторение сделано" /> : <span className={css.blank} />}
        <div className="min-w-0">
          <h2 className={cx(css.sheetTitle, !last && css.later)}>Повторение</h2>
          {reviewed ? (
            <p className={nb.meta} data-testid="day-done">
              {withCount(reviewed, ["карточка", "карточки", "карточек"])} сегодня
            </p>
          ) : last ? (
            <p className={nb.meta} data-testid="day-done">
              На сегодня карточек нет
            </p>
          ) : (
            <p className={nb.meta} data-testid="cards-later">
              Карточки появятся после первого выполненного задания урока
            </p>
          )}
        </div>
      </div>
      {last && (
        <button type="button" className={css.quiet} onClick={practice} disabled={busy}>
          Потренировать {lessonIn(last.title, "урок")} — интервалы не сдвинутся
        </button>
      )}
      {error}
    </div>
  );
}

function Cells({ done, total }: { done: number; total: number }) {
  return (
    <span className={css.cells} role="img" aria-label={`заданий выполнено ${done} из ${total}`}>
      {Array.from({ length: total }, (_, index) =>
        index < done ? <Tick key={index} className={css.cellTick} label="" /> : <i key={index} className={css.cell} />,
      )}
    </span>
  );
}

function LessonNext({
  view,
  lesson,
  primary,
  week,
}: {
  view: ModuleView;
  lesson: ModuleLessonView;
  primary: boolean;
  week?: number;
}) {
  const { module } = view;
  const started = lesson.tally.done > 0;
  const test = lesson.kind === "test" && !/контрольн/i.test(lesson.title);
  return (
    <Link to={`/course/${module.id}/${lesson.id}`} className={css.lesson} data-testid="course-next">
      <span className={css.cover} style={{ background: coverColor(module.number) }} aria-hidden="true">
        <b>{String(module.number).padStart(2, "0")}</b>
        <em lang={languageOfText(module.title).code}>{module.title}</em>
        <i className={css.ribbon} />
      </span>
      <span className={css.lessonBody}>
        <span className="sr-only">Модуль {module.number}. </span>
        <span className={css.lessonTitle}>
          {test ? "Контрольная · " : ""}
          {lesson.title}
        </span>
        {lesson.installed ? (
          <Cells done={lesson.tally.done} total={lesson.tally.total} />
        ) : (
          <span className={nb.meta}>урок скачается при открытии</span>
        )}
        {week !== undefined && (
          <span className={css.week}>
            неделя
            <span className={css.dots} role="img" aria-label={`занятий на этой неделе: ${week}`}>
              {Array.from({ length: Math.max(WEEK_PLAN, week) }, (_, index) => (
                <i key={index} className={cx(css.dot, index < week && css.dotDone)} />
              ))}
            </span>
          </span>
        )}
      </span>
      <span className={cn(buttonVariants({ variant: primary ? "default" : "soft", size: "md" }), css.lessonAction)}>
        {started ? "Продолжить урок" : "Начать урок"}
        {primary && <ArrowRight data-icon="inline-end" />}
      </span>
    </Link>
  );
}

function ModulePage({
  view,
  current,
  week,
  monday,
  today,
}: {
  view: ModuleView;
  current: string;
  week: string[];
  monday: string;
  today: string;
}) {
  const { module } = view;
  const rows = [...view.lessons, ...(view.checkpoint ? [view.checkpoint] : []), ...view.review];
  let lessonNumber = 0;
  return (
    <section className={cx(nb.page, css.page)} aria-label={`Модуль ${module.number}`}>
      <p className={cx(nb.date, css.left)}>Модуль {String(module.number).padStart(2, "0")}</p>
      <h2 className={nb.title} lang={languageOfText(module.title).code}>
        {module.title}
      </h2>
      <ol className={css.toc}>
        {rows.map((lesson) => (
          <li key={lesson.id} className={cx(lesson.id === current && css.current)}>
            <Link to={`/course/${module.id}/${lesson.id}`}>
              <span className={css.tocNumber}>{lesson.kind === "test" ? "✎" : ++lessonNumber}</span>
              <span className={css.tocTitle}>{lesson.title}</span>
              {lesson.completed ? (
                <Tick className={css.cellTick} label="пройден" />
              ) : lesson.installed ? (
                <Cells done={lesson.tally.done} total={lesson.tally.total} />
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
      <div className={css.weekRow}>
        <span className={nb.meta}>эта неделя</span>
        <WeekStrip
          monday={monday}
          today={today}
          lessons={week}
          label={(name, lesson) => `${name}${lesson ? ": занятие" : ""}`}
        />
      </div>
    </section>
  );
}
