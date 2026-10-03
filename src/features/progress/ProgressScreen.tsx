import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { Screen } from "../../app/Screen";
import { SKILL_LABEL } from "../../content/course";
import { PASS_SHARE } from "../../domain/course";
import { addDays } from "../../domain/learning";
import { CHECKPOINTS, type SkillReadiness } from "../../domain/progress";
import { useNow } from "../../shared/clock";
import { cx } from "../../shared/cx";
import { withCount } from "../../shared/format";
import { coverColor } from "../../shared/notebook";
import { useSpread } from "../../shared/spread";
import { useSettings } from "../../shared/store";
import { courseProgress, type CourseProgress } from "../../storage/progress";
import { ExamLine } from "../course/ExamLine";
import { DeviceStatus } from "./DeviceStatus";
import css from "./progress.module.css";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEK_PLAN = 3;
const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const dayMonth = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const LESSONS: [string, string, string] = ["урок", "урока", "уроков"];

export function ProgressScreen() {
  const now = useNow();
  const { settings } = useSettings();
  const spread = useSpread();
  const data = useLiveQuery(() => courseProgress(now, settings.timezone), [now.toDateString(), settings.timezone]);
  if (!data) return <Screen wide paper />;
  const courseId = data.views[0]?.module.courseId;
  const head = (
    <>
      {courseId && (
        <div className={css.exam}>
          <ExamLine courseId={courseId} />
        </div>
      )}
      <h1 className={css.title}>Прогресс</h1>
    </>
  );
  const ready = <Readiness readiness={data.readiness} />;
  const week = <Week week={data.week} />;
  const path = <Path data={data} />;
  const tail = (
    <>
      <ul className={css.links}>
        <li>
          <Link to="/more/stats">Ответы и сроки повторений</Link>
        </li>
        <li>
          <Link to="/more/settings">Настройки</Link>
        </li>
        <li>
          <Link to="/more/backup">Копия данных</Link>
        </li>
      </ul>
      <DeviceStatus />
    </>
  );
  return (
    <Screen wide paper>
      {spread ? (
        <div className={css.spread}>
          <div className={css.page}>
            {head}
            {ready}
            {week}
          </div>
          <div className={css.page}>
            {path}
            {tail}
          </div>
        </div>
      ) : (
        <div className={css.page}>
          {head}
          {ready}
          {path}
          {week}
          {tail}
        </div>
      )}
    </Screen>
  );
}

function Readiness({ readiness }: { readiness: SkillReadiness[] }) {
  return (
    <section aria-labelledby="readiness">
      <h2 id="readiness" className={css.heading}>
        Готовность к A2
      </h2>
      <p className={css.note}>
        Порог экзамена — 60 % в каждом навыке. Чтение и аудирование — по контрольным; письмо и речь — ваша самопроверка,
        не оценка экзаменатора.
      </p>
      <ul className={css.skills}>
        {(["reading", "listening", "writing", "speaking"] as const).map((skill) => {
          const item = readiness.find((entry) => entry.skill === skill);
          const percent = item ? Math.round(item.share * 100) : null;
          const weak = item !== undefined && item.share < PASS_SHARE;
          const label = SKILL_LABEL[skill];
          return (
            <li key={skill} className={cx(weak && css.weak)} data-testid={`skill-${skill}`}>
              <span className={css.skill}>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
              <span
                className={css.bar}
                role="img"
                aria-label={percent === null ? "нет данных" : `${percent} % при пороге 60 %`}
              >
                {Array.from({ length: 10 }, (_, index) => (
                  <i
                    key={index}
                    className={cx(
                      percent !== null && index < Math.round(percent / 10) && css.filled,
                      item?.source === "self" && css.self,
                    )}
                  />
                ))}
                <b className={css.threshold} />
              </span>
              <span className={css.percent}>{percent === null ? "—" : `${percent}%`}</span>
              <span className={css.basis}>
                {!item
                  ? skill === "reading" || skill === "listening"
                    ? "появится после первой контрольной"
                    : "появится после первого задания"
                  : item.source === "test"
                    ? item.basis
                    : `самопроверка, ${withCount(Number(item.basis), ["задание", "задания", "заданий"])}`}
                {weak && " · ниже 60 %"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Path({ data }: { data: CourseProgress }) {
  const { pace, views, current } = data;
  const next = pace.next;
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
      <p className={css.plan} data-testid="pace">
        {next ? (
          <>
            К {next.checkpoint.label} ({dayMonth(next.checkpoint.date)}) — модуль{" "}
            {String(next.checkpoint.afterModule).padStart(2, "0")}, ещё {withCount(next.remaining, LESSONS)}. Нужно{" "}
            <b>{number(next.perWeek)} в неделю</b>; за последние четыре недели — {number(pace.recentPerWeek)}.{" "}
          </>
        ) : (
          <>Все уроки до последней контрольной точки пройдены. </>
        )}
        {pace.lagWeeks ? (
          <span className={css.lag}>
            Отставание от календаря курса — {withCount(pace.lagWeeks, ["неделя", "недели", "недель"])}.
          </span>
        ) : (
          <span>Идёте по календарю курса.</span>
        )}
      </p>
    </section>
  );
}

function Week({ week }: { week: CourseProgress["week"] }) {
  const lessons = week.lessonDays.length;
  const reviews = week.reviewDays.length;
  return (
    <section aria-labelledby="week">
      <h2 id="week" className={css.heading}>
        Эта неделя
      </h2>
      <div className={css.days}>
        {WEEKDAYS.map((name, index) => {
          const day = addDays(week.monday, index);
          const lesson = week.lessonDays.includes(day);
          const review = week.reviewDays.includes(day);
          return (
            <span
              key={name}
              className={cx(css.day, lesson && css.dayLesson, day === week.today && css.dayToday)}
              aria-label={[name, lesson && "урок", review && "повторение"].filter(Boolean).join(", ")}
            >
              {name}
              {review && <i className={css.dayReview} aria-hidden />}
            </span>
          );
        })}
      </div>
      <p className={css.plan}>
        {withCount(lessons, ["занятие", "занятия", "занятий"])} из {WEEK_PLAN} · повторение{" "}
        {withCount(reviews, ["день", "дня", "дней"])} · {withCount(week.cards, ["карточка", "карточки", "карточек"])}
      </p>
    </section>
  );
}
