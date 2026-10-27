import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { deviceTimezone, mondayOf, type DailyPlan } from "../../domain/learning";
import { PROFILES, type Language } from "../../domain/language";
import type { Session } from "../../domain/types";
import { useAction } from "../../shared/action";
import { cx } from "../../shared/cx";
import { lessonIn, withCount } from "../../shared/format";
import { ProfileContext, useCourseProfile, useProfile } from "../../shared/language";
import { useCoursePalette, useStartedCourses } from "../../shared/courses";
import { upcomingCourses, type CourseEntry } from "../../storage/courses";
import { coverColor, pageDate } from "../../shared/notebook";
import { useSpread } from "../../shared/media";
import nb from "../../shared/notebook.module.css";
import { Tick } from "../../shared/Tick";
import {
  courseFinished,
  lessonDays,
  moduleViews,
  nextStep,
  reviewedOn,
  type ModuleLessonView,
  type ModuleView,
} from "../../storage/course";
import { dexieSource } from "../../storage/queries";
import { courseReadings } from "../../storage/readings";
import { sessionPath, startSession } from "../learning/session-actions";
import { CourseCaption, CourseLessonLine, courseCaption, MoreCourses } from "./CourseLessonLine";
import { DayNotes } from "./DayNotes";
import { lessonLines } from "./lessons";
import { ReadingSheet } from "./ReadingSheet";
import css from "./today.module.css";

/** Ориентир курса — 2–3 занятия в неделю; точек недели не меньше трёх. */
const WEEK_PLAN = 3;

/** Возврат курса с экрана «Все курсы на паузе» меняет весь экран: фокус — на заголовок нового, а не на body. */
export const titleFocus = { pending: false };

/**
 * «Сегодня» основного языка — страница тетради с двумя ритмами: повторение каждый день, урок 2–3 раза в неделю.
 * Повторение общее для курсов языка, крупный урок, «Чтение» и разворот — основного курса языка, под ним — строки
 * уроков других его курсов. Главная кнопка одна: у повторения, пока оно ждёт, потом у урока.
 */
export function LanguageToday({
  language,
  courses,
  plan,
  unfinished,
  more,
}: {
  /** `null` — курсов в каталоге нет: план по всем урокам, как до курсов. */
  language: Language | null;
  /** Курсы языка на «Сегодня», основной первым. */
  courses: CourseEntry[];
  plan: DailyPlan;
  unfinished: Session | null;
  more?: React.ReactNode;
}) {
  const spread = useSpread();
  const today = plan.today;
  const monday = mondayOf(today);
  const main = courses[0];
  const courseId = main?.id;
  const started = useStartedCourses();
  // Неделя и счёт — по всем начатым курсам языка, в том числе на паузе: занятие, начатое до паузы, засчитывается.
  const counted =
    started && language ? started.filter((course) => course.language === language).map((course) => course.id) : [];
  const scope = !language ? undefined : counted.length ? counted : courseId;
  const scopeKey = typeof scope === "string" ? scope : scope?.join(" ");
  const ready = started !== undefined;
  const views = useLiveQuery(() => moduleViews(courseId), [courseId]);
  const reviewed = useLiveQuery(async () => (ready ? reviewedOn(today, scope) : undefined), [today, ready, scopeKey]);
  const week = useLiveQuery(
    async () => (!ready ? undefined : spread ? [] : lessonDays(monday, deviceTimezone(), scope)),
    [monday, deviceTimezone(), ready, scopeKey, spread],
  );
  const courseProfile = useCourseProfile(courseId);
  const profile = language ? PROFILES[language] : courseProfile;
  const title = useRef<HTMLHeadingElement>(null);
  const shown = !!views && reviewed !== undefined;
  useEffect(() => {
    if (!shown || !titleFocus.pending) return;
    titleFocus.pending = false;
    title.current?.focus();
  }, [shown]);
  const readings = useLiveQuery(async () => (courseId ? await courseReadings(courseId) : null), [courseId]);
  const following = useLiveQuery(
    async () => (courseId ? ((await upcomingCourses()).find((course) => course.after === courseId) ?? null) : null),
    [courseId],
  );

  const lessons = (views ?? []).flatMap((view) => [
    ...view.lessons,
    ...(view.checkpoint ? [view.checkpoint] : []),
    ...view.review,
  ]);
  const last = lessons.filter((lesson) => lesson.completed).at(-1);
  const next = nextStep(views ?? []);
  const finished = courseFinished(views ?? [], next);
  const due = plan.newRefs.length + plan.reviews.length;
  const reviewFirst = !!unfinished || due > 0;
  if (!views || reviewed === undefined || !week || readings === undefined || following === undefined)
    return <div aria-busy="true" aria-label="План дня загружается" />;

  const { shown: rows, more: hidden } = lessonLines([
    ...(main ? [main] : []),
    ...courses.slice(1).filter((course) => course.installed),
  ]);
  const caption = rows.length > 1 && main ? courseCaption(main) : undefined;
  const page = (
    <section className={cx(nb.page, css.page)}>
      <p className={nb.date} lang={profile.code}>
        {pageDate(today, profile)}
      </p>
      <h1 ref={title} className="sr-only" data-testid="today-title" tabIndex={-1}>
        Сегодня
      </h1>
      <Review
        courseId={courseId}
        courseIds={courses.map((course) => course.id)}
        plan={plan}
        unfinished={unfinished}
        reviewed={reviewed ?? 0}
        last={last}
        primary={reviewFirst}
      />
      {courseId && readings && <ReadingSheet readings={readings} primary={!reviewFirst && next === null} />}
      <DayNotes plan={plan} />
      {finished ? (
        <>
          <p className={css.finished} data-testid="course-finished">
            {profile.finished}
          </p>
          {following ? (
            <p className={css.finished} data-testid="next-course">
              Следующий курс — {following.level ? `${following.title} · ${following.level}` : following.title}:
              готовится.{" "}
              <Link to="/course" state={{ course: following.id }} className="text-primary underline">
                Открыть страницу курса
              </Link>
            </p>
          ) : null}
        </>
      ) : next ? (
        <LessonNext
          view={next.view}
          lesson={next.lesson}
          primary={!reviewFirst}
          week={spread ? undefined : (week?.length ?? 0)}
          caption={caption}
        />
      ) : null}
      {rows.length > 1 && (
        <div className={css.courseLines}>
          {rows.slice(1).map((course) => (
            <CourseLessonLine key={course.id} course={course} caption />
          ))}
          {language && <MoreCourses language={PROFILES[language].names.title} courses={hidden} />}
        </div>
      )}
      {more}
    </section>
  );
  return (
    <ProfileContext value={profile}>
      {!spread || !next ? (
        page
      ) : (
        <div className={cx(nb.spread, css.spread)}>
          {page}
          <ModulePage view={next.view} current={next.lesson.id} />
        </div>
      )}
    </ProfileContext>
  );
}

function Review({
  courseId,
  courseIds,
  plan,
  unfinished,
  reviewed,
  last,
  primary,
}: {
  courseId: string | undefined;
  courseIds: string[];
  plan: DailyPlan;
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
      const session = unfinished ?? (await startSession(new Date(), courseIds.length ? { courseIds } : {}));
      if (!session) return setProblem("На сегодня карточек нет.");
      void navigate(await sessionPath(session));
    });
  // Тренировка не сдвигает интервалы: навык фиксируется, расписание повторений остаётся прежним.
  const practice = () =>
    run(async () => {
      if (!last) return;
      const refs = await dexieSource().lessonRefs(last.id);
      const session = refs.length ? await startSession(new Date(), { refs, mode: "practice", courseId }) : null;
      if (!session) return setProblem("В уроке нет карточек для тренировки.");
      void navigate(await sessionPath(session));
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

export function LessonNext({
  view,
  lesson,
  primary,
  week,
  caption,
}: {
  view: ModuleView;
  lesson: ModuleLessonView;
  primary: boolean;
  week?: number;
  caption?: string;
}) {
  const { module } = view;
  const { code } = useProfile();
  const palette = useCoursePalette(module.courseId);
  const started = lesson.tally.done > 0;
  const test = lesson.kind === "test" && !/контрольн/i.test(lesson.title);
  return (
    <Link to={`/course/${module.id}/${lesson.id}`} className={css.lesson} data-testid="course-next">
      <span className={css.cover} style={{ background: coverColor(module.number, palette) }} aria-hidden="true">
        <b>{String(module.number).padStart(2, "0")}</b>
        <em lang={code}>{module.title}</em>
        <i className={css.ribbon} />
      </span>
      <span className={css.lessonBody}>
        {caption && <CourseCaption>{caption}</CourseCaption>}
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

function ModulePage({ view, current }: { view: ModuleView; current: string }) {
  const { module } = view;
  const { code } = useProfile();
  const rows = [...view.lessons, ...(view.checkpoint ? [view.checkpoint] : []), ...view.review];
  let lessonNumber = 0;
  return (
    <section className={cx(nb.page, css.page)} aria-label={`Модуль ${module.number}`}>
      <p className={cx(nb.date, css.left)}>Модуль {String(module.number).padStart(2, "0")}</p>
      <h2 className={nb.title} lang={code}>
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
    </section>
  );
}
