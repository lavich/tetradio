import { useLiveQuery } from "dexie-react-hooks";
import { useId } from "react";
import { Link } from "react-router-dom";
import { Screen } from "../../app/Screen";
import { SKILL_LABEL } from "../../content/course";
import type { SkillProgress } from "../../domain/progress";
import { SOLID_DAYS, type Leech } from "../../domain/stats";
import { useNow } from "../../shared/clock";
import { LanguageSwitch } from "../../shared/CourseSwitch";
import { cx } from "../../shared/cx";
import { dayMonth, pausedSince, withCount } from "../../shared/format";
import { courseName, useCoursePalette } from "../../shared/courses";
import { DEFAULT_LANGUAGE, PROFILES } from "../../domain/language";
import { coverColor } from "../../shared/notebook";
import { useSpread } from "../../shared/media";
import nb from "../../shared/notebook.module.css";
import { deviceTimezone, studyDay } from "../../domain/time";
import { cardsInCourse, currentLanguage, primaryCourse } from "../../storage/courses";
import { courseProgress, languageProgress, type CourseProgress, type LanguageProgress } from "../../storage/progress";
import { useStats } from "../../shared/store";
import { languageDictionary, type DictionaryLesson } from "../../storage/dictionary";
import { entryPath } from "../words/WordsScreen";
import { SyncLine } from "./SyncLine";
import { Weeks } from "./Weeks";
import css from "./progress.module.css";

const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const LESSONS: [string, string, string] = ["урок", "урока", "уроков"];

export function ProgressScreen() {
  const now = useNow();
  const spread = useSpread();
  const data = useLiveQuery(async () => {
    const language = await currentLanguage();
    const progress = await languageProgress(now, deviceTimezone(), language);
    const started = progress.courses.map((item) => item.course.id);
    const primary = started.length ? undefined : await primaryCourse();
    const ids = primary ? [primary] : started;
    return {
      language,
      progress,
      alone: started.length ? undefined : await courseProgress(now, deviceTimezone(), primary),
      words: await languageDictionary(language),
      ids,
    };
  }, [studyDay(now, deviceTimezone()), deviceTimezone()]);
  const stats = useStats(now);
  const ids = data?.ids;
  const leeches = useLiveQuery(async () => {
    const all = stats?.leeches ?? [];
    if (!ids) return all;
    const own = await cardsInCourse(
      all.map((leech) => leech.unitKey),
      ids,
    );
    return all.filter((leech) => own.has(leech.unitKey));
  }, [stats, ids?.join()]);
  if (!data) return <Screen wide />;
  const profile = PROFILES[data.language ?? DEFAULT_LANGUAGE];
  const { courses, total } = data.progress;
  const head = (
    <>
      <LanguageSwitch />
      <h1 className={nb.title}>Прогресс</h1>
    </>
  );
  const cards = (level: 2 | 3) => (
    <Cards
      level={level}
      words={data.words}
      leeches={leeches ?? []}
      lang={profile.code}
      started={courses.some((course) => course.pace.done > 0)}
    />
  );
  const tail = (
    <div className={css.foot}>
      <SyncLine />
      <Link className={css.more} to="/progress/settings">
        Настройки и данные
      </Link>
    </div>
  );
  const weeks = (
    data: Pick<CourseProgress, "days" | "week">,
    pausedAt: string | undefined,
    several: boolean,
    level: 2 | 3,
  ) => (
    <Weeks
      key={profile.code}
      data={data}
      pausedAt={pausedAt}
      timezone={deviceTimezone()}
      summary={weekLine(data.week, several)}
      language={several}
      level={level}
    />
  );
  if (courses.length > 1) {
    const summary = (
      <section aria-labelledby="language-total" data-testid="language-total">
        <h2 id="language-total" className={css.total}>
          Всего {profile.names.by}
        </h2>
        {weeks(total, allPaused(courses), true, 3)}
        <Skills skills={total.skills} complete level={3} />
        {cards(3)}
      </section>
    );
    const blocks = courses.map((item) => <CourseBlock key={item.course.id} data={item} />);
    return (
      <Screen wide>
        {spread ? (
          <div className={nb.spread}>
            <div className={cx(nb.page, css.page)}>
              {head}
              {summary}
              {tail}
            </div>
            <div className={cx(nb.page, css.page)}>{blocks}</div>
          </div>
        ) : (
          <div className={css.page}>
            {head}
            {summary}
            {blocks}
            {tail}
          </div>
        )}
      </Screen>
    );
  }
  const one = courses[0] ?? data.alone!;
  const title = courses[0] && (
    <h2 className={css.total} data-testid="progress-course">
      {courseName(courses[0].course)}
    </h2>
  );
  const path = (
    <>
      <Path data={one} pausedAt={courses[0]?.course.pausedAt} />
      {weeks(one, courses[0]?.course.pausedAt, false, 2)}
    </>
  );
  const ready = <Skills skills={one.skills} complete={one.complete} passShare={one.passShare} />;
  return (
    <Screen wide>
      {spread ? (
        <div className={nb.spread}>
          <div className={cx(nb.page, css.page)}>
            {head}
            {title}
            {path}
            {ready}
          </div>
          <div className={cx(nb.page, css.page)}>
            {cards(2)}
            {tail}
          </div>
        </div>
      ) : (
        <div className={css.page}>
          {head}
          {title}
          {path}
          {ready}
          {cards(2)}
          {tail}
        </div>
      )}
    </Screen>
  );
}

function CourseBlock({ data }: { data: LanguageProgress["courses"][number] }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={css.courseBlock} data-testid="progress-course">
      <h2 id={heading} className={css.total}>
        {courseName(data.course)}
      </h2>
      <Path data={data} pausedAt={data.course.pausedAt} level={3} />
      <Skills skills={data.skills} complete={data.complete} passShare={data.passShare} level={3} course />
    </section>
  );
}

/** В сумме языка пауза штрихуется, только когда стоят все курсы: с самой поздней паузы. */
const allPaused = (courses: LanguageProgress["courses"]) =>
  courses.every((item) => item.course.pausedAt)
    ? courses
        .map((item) => item.course.pausedAt!)
        .sort()
        .at(-1)
    : undefined;

const weekLine = ({ lessonDays, reviewDays }: CourseProgress["week"], language: boolean) => {
  if (!lessonDays.length && !reviewDays.length) return "На этой неделе занятий ещё не было.";
  const parts = [
    lessonDays.length
      ? withCount(lessonDays.length, ["занятие", "занятия", "занятий"]) + (language ? " по курсам языка" : " курса")
      : "",
    reviewDays.length ? `повторение ${withCount(reviewDays.length, ["день", "дня", "дней"])}` : "",
  ].filter(Boolean);
  return `На этой неделе: ${parts.join(", ")}.`;
};

function Skills({
  skills,
  complete,
  passShare,
  level = 2,
  course = level === 2,
}: {
  skills: SkillProgress[];
  complete: boolean;
  passShare?: number;
  level?: 2 | 3;
  course?: boolean;
}) {
  const heading = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={heading}>
      <Heading id={heading} className={css.heading}>
        {course ? "Навыки по курсу" : "Навыки по языку"}
      </Heading>
      <p className={css.note}>
        {course
          ? "Доля всего курса по навыку, выполненная верно. Письмо и речь — по вашей самопроверке."
          : "Доля всех начатых курсов языка по навыку, выполненная верно. Письмо и речь — по вашей самопроверке."}
        {complete ? "" : " Курс ещё скачивается: доли считаются по скачанным урокам."}
      </p>
      <ul className={css.skills}>
        {(["reading", "listening", "writing", "speaking"] as const).map((skill) => {
          const item = skills.find((entry) => entry.skill === skill);
          const share = item?.total ? item.earned / item.total : 0;
          const percent = Math.round(share * 100);
          const quality = item?.attempted ? item.earned / item.attempted : null;
          const weak = course && quality !== null && passShare !== undefined && quality < passShare;
          const label = SKILL_LABEL[skill];
          return (
            <li key={skill} className={cx(weak && css.weak)} data-testid={`skill-${skill}`}>
              <span className={css.skill}>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
              <span className={css.bar} role="img" aria-label={`${percent} % ${course ? "курса" : "по языку"}`}>
                {Array.from({ length: 10 }, (_, index) => (
                  <i key={index}>
                    <span
                      className={cx(item?.source === "self" && css.self)}
                      style={{ width: `${Math.min(1, Math.max(0, share * 10 - index)) * 100}%` }}
                    />
                  </i>
                ))}
              </span>
              <span className={css.percent}>{percent} %</span>
              <span className={css.basis}>
                {quality === null
                  ? "ещё не начато"
                  : `${item?.source === "self" ? "самопроверка" : "из пройденного верно"} ${Math.round(quality * 100)} %`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Cards({
  words,
  leeches,
  lang,
  started,
  level,
}: {
  words: DictionaryLesson[] | undefined;
  leeches: Leech[];
  lang: string;
  started: boolean;
  level: 2 | 3;
}) {
  const entries = words?.flatMap((lesson) => lesson.entries) ?? [];
  const learning = entries.filter((entry) => entry.mark === "learning").length;
  const solid = entries.filter((entry) => entry.mark === "solid").length;
  const heading = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={heading}>
      <Heading id={heading} className={css.heading}>
        Слова и фразы
      </Heading>
      <p className={css.plan} data-testid="cards-line">
        {learning || solid ? (
          <>
            Учу <b>{learning}</b>, закреплено <b>{solid}</b> — с интервалом повторения от {SOLID_DAYS} дня.{" "}
          </>
        ) : started ? (
          "Карточки начатых уроков ждут в «Повторить». "
        ) : (
          "Карточки появятся после первого выполненного задания урока. "
        )}
        <Link to="/words">Словарь</Link>
      </p>
      {leeches.length ? (
        <p className={css.plan} data-testid="leeches">
          Не даются:{" "}
          {leeches.slice(0, 6).map((leech, index) => (
            <span key={leech.unitKey}>
              {index ? ", " : ""}
              <Link to={entryPath(leech)} lang={lang}>
                {leech.label}
              </Link>
            </span>
          ))}
          {leeches.length > 6 ? ` и ещё ${leeches.length - 6}` : ""}
        </p>
      ) : null}
    </section>
  );
}

export function Path({ data, pausedAt, level = 2 }: { data: CourseProgress; pausedAt?: string; level?: 2 | 3 }) {
  const { pace, views, current, calendar } = data;
  const palette = useCoursePalette(views[0]?.module.courseId);
  const heading = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={heading}>
      <Heading id={heading} className={css.heading}>
        Путь по курсу
      </Heading>
      <p className={css.module}>
        Модуль {String(current).padStart(2, "0")} <span>из {views.length || 24}</span>
      </p>
      <div className={css.spines} role="img" aria-label={`пройдено уроков: ${pace.done} из ${pace.total}`}>
        {views.map((view) => {
          const point = calendar?.checkpoints.find((item) => item.afterModule === view.module.number);
          const done = view.completed && (!view.checkpoint || view.checkpoint.completed);
          return (
            <span key={view.module.id} className={css.spineSlot}>
              <i
                className={cx(css.spine, view.module.number === current && !done && css.current)}
                style={
                  done ? { background: coverColor(view.module.number, palette), borderColor: "transparent" } : undefined
                }
              />
              {point && <b className={css.point}>{point.label}</b>}
            </span>
          );
        })}
      </div>
      {pausedAt && (
        <p className={css.plan} data-testid="progress-paused">
          Курс на паузе с {pausedSince(pausedAt)}. Календарь курса не сдвигается.
        </p>
      )}
      <Pace pace={pace} planned={!!calendar} />
    </section>
  );
}

function Pace({ pace, planned }: { pace: CourseProgress["pace"]; planned: boolean }) {
  const ahead = pace.done - pace.planned;
  const next = pace.next;
  const slow = next && pace.recentPerWeek !== null && pace.recentPerWeek < next.perWeek;
  if (!planned)
    return (
      <div data-testid="pace">
        <p className={css.plan}>
          Пройдено <b>{pace.done}</b> из {withCount(pace.total, LESSONS)}.
          {pace.recentPerWeek !== null && ` Ваш темп — ${number(pace.recentPerWeek)} в неделю.`}
        </p>
      </div>
    );
  return (
    <div data-testid="pace">
      <p className={css.plan}>
        Пройдено <b>{pace.done}</b> из {withCount(pace.total, LESSONS)}.{" "}
        {pace.lagWeeks ? (
          <span className={css.lag}>
            Отставание от календаря — {withCount(-ahead, LESSONS)}, около{" "}
            {withCount(pace.lagWeeks, ["недели", "недель", "недель"])}.
          </span>
        ) : ahead > 0 ? (
          `Впереди календаря на ${withCount(ahead, LESSONS)}.`
        ) : (
          "Точно по календарю."
        )}
      </p>
      <p className={css.plan}>
        {next ? (
          <>
            До {next.checkpoint.label} ({next.checkpoint.title}, {dayMonth(next.checkpoint.date)}) — ещё{" "}
            {withCount(next.remaining, LESSONS)}, нужно <b>{number(next.perWeek)} в неделю</b>.
            {pace.recentPerWeek !== null && (
              <span className={cx(slow && css.lag)}> Ваш темп — {number(pace.recentPerWeek)} в неделю.</span>
            )}
          </>
        ) : (
          "Все уроки до последней контрольной точки пройдены."
        )}
      </p>
    </div>
  );
}
