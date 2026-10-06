import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { Screen } from "../../app/Screen";
import { SKILL_LABEL } from "../../content/course";
import { PASS_SHARE } from "../../domain/course";
import { CHECKPOINTS, type SkillProgress } from "../../domain/progress";
import { SOLID_DAYS, type Leech } from "../../domain/stats";
import { useNow } from "../../shared/clock";
import { cx } from "../../shared/cx";
import { dayMonth, withCount } from "../../shared/format";
import { coverColor } from "../../shared/notebook";
import { useSpread } from "../../shared/media";
import nb from "../../shared/notebook.module.css";
import { deviceTimezone } from "../../domain/time";
import { courseProgress, type CourseProgress } from "../../storage/progress";
import { useStats } from "../../shared/store";
import { dictionary, type DictionaryLesson } from "../../storage/dictionary";
import { entryPath } from "../words/WordsScreen";
import { SyncLine } from "./SyncLine";
import css from "./progress.module.css";

const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const LESSONS: [string, string, string] = ["урок", "урока", "уроков"];

export function ProgressScreen() {
  const now = useNow();
  const spread = useSpread();
  const data = useLiveQuery(() => courseProgress(now, deviceTimezone()), [now.toDateString(), deviceTimezone()]);
  const words = useLiveQuery(() => dictionary(), []);
  const stats = useStats(now);
  if (!data) return <Screen wide />;
  const head = <h1 className={nb.title}>Прогресс</h1>;
  const path = <Path data={data} />;
  const ready = <Skills skills={data.skills} complete={data.complete} />;
  const cards = <Cards words={words} leeches={stats?.leeches ?? []} started={data.pace.done > 0} />;
  const tail = (
    <>
      <p className={css.weekLine} data-testid="week">
        {weekLine(data.week)}
      </p>
      <div className={css.foot}>
        <SyncLine />
        <Link className={css.more} to="/progress/settings">
          Настройки и данные
        </Link>
      </div>
    </>
  );
  return (
    <Screen wide>
      {spread ? (
        <div className={cx(nb.spread, nb.spine)}>
          <div className={cx(nb.page, css.page)}>
            {head}
            {path}
            {ready}
          </div>
          <div className={cx(nb.page, css.page)}>
            {cards}
            {tail}
          </div>
        </div>
      ) : (
        <div className={css.page}>
          {head}
          {path}
          {ready}
          {cards}
          {tail}
        </div>
      )}
    </Screen>
  );
}

const weekLine = ({ lessonDays, reviewDays }: CourseProgress["week"]) => {
  if (!lessonDays.length && !reviewDays.length) return "На этой неделе занятий ещё не было.";
  const parts = [
    lessonDays.length ? withCount(lessonDays.length, ["занятие", "занятия", "занятий"]) + " курса" : "",
    reviewDays.length ? `повторение ${withCount(reviewDays.length, ["день", "дня", "дней"])}` : "",
  ].filter(Boolean);
  return `На этой неделе: ${parts.join(", ")}.`;
};

function Skills({ skills, complete }: { skills: SkillProgress[]; complete: boolean }) {
  return (
    <section aria-labelledby="skills">
      <h2 id="skills" className={css.heading}>
        Навыки по курсу
      </h2>
      <p className={css.note}>
        Доля всего курса по навыку, выполненная верно. Письмо и речь — по вашей самопроверке.
        {complete ? "" : " Курс ещё скачивается: доли считаются по скачанным урокам."}
      </p>
      <ul className={css.skills}>
        {(["reading", "listening", "writing", "speaking"] as const).map((skill) => {
          const item = skills.find((entry) => entry.skill === skill);
          const share = item?.total ? item.earned / item.total : 0;
          const percent = Math.round(share * 100);
          const quality = item?.attempted ? item.earned / item.attempted : null;
          const weak = quality !== null && quality < PASS_SHARE;
          const label = SKILL_LABEL[skill];
          return (
            <li key={skill} className={cx(weak && css.weak)} data-testid={`skill-${skill}`}>
              <span className={css.skill}>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
              <span className={css.bar} role="img" aria-label={`${percent} % курса`}>
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
  started,
}: {
  words: DictionaryLesson[] | undefined;
  leeches: Leech[];
  started: boolean;
}) {
  const entries = words?.flatMap((lesson) => lesson.entries) ?? [];
  const learning = entries.filter((entry) => entry.mark === "learning").length;
  const solid = entries.filter((entry) => entry.mark === "solid").length;
  return (
    <section aria-labelledby="cards">
      <h2 id="cards" className={css.heading}>
        Слова и фразы
      </h2>
      <p className={css.plan} data-testid="cards-line">
        {learning || solid ? (
          <>
            Учу <b>{learning}</b>, закреплено <b>{solid}</b> — с интервалом повторения от {SOLID_DAYS} дня.{" "}
          </>
        ) : started ? (
          "Карточки пройденных уроков приходят в «Повторить» по дневному пределу. "
        ) : (
          "Карточки появятся после первого пройденного урока. "
        )}
        <Link to="/words">Словарь</Link>
      </p>
      {leeches.length ? (
        <p className={css.plan} data-testid="leeches">
          Не даются:{" "}
          {leeches.slice(0, 6).map((leech, index) => (
            <span key={leech.unitKey}>
              {index ? ", " : ""}
              <Link to={entryPath(leech)} lang="el">
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

function Path({ data }: { data: CourseProgress }) {
  const { pace, views, current } = data;
  return (
    <section aria-labelledby="path">
      <h2 id="path" className={css.heading}>
        Путь по курсу
      </h2>
      <p className={css.module}>
        Модуль {String(current).padStart(2, "0")} <span>из {views.length || 24}</span>
      </p>
      <div className={css.spines} role="img" aria-label={`пройдено уроков: ${pace.done} из ${pace.total}`}>
        {views.map((view) => {
          const point = CHECKPOINTS.find((item) => item.afterModule === view.module.number);
          const done = view.completed && (!view.checkpoint || view.checkpoint.completed);
          return (
            <span key={view.module.id} className={css.spineSlot}>
              <i
                className={cx(css.spine, view.module.number === current && !done && css.current)}
                style={done ? { background: coverColor(view.module.number), borderColor: "transparent" } : undefined}
              />
              {point && <b className={css.point}>{point.label}</b>}
            </span>
          );
        })}
      </div>
      <Pace pace={pace} />
    </section>
  );
}

function Pace({ pace }: { pace: CourseProgress["pace"] }) {
  const ahead = pace.done - pace.planned;
  const next = pace.next;
  const slow = next && pace.recentPerWeek !== null && pace.recentPerWeek < next.perWeek;
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
