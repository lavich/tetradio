import { useId, useLayoutEffect, useRef } from "react";
import { studyDay } from "../../domain/time";
import { weekGrid } from "../../domain/weeks";
import { cx } from "../../shared/cx";
import { dayMonth, withCount } from "../../shared/format";
import type { CourseProgress } from "../../storage/progress";
import css from "./progress.module.css";

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const DAY_LABELS = ["Пн", "", "Ср", "", "Пт", "", ""];
const DAYS: [string, string, string] = ["день", "дня", "дней"];

function weekLabel(monday: string, lessons: number, reviews: number, goal: boolean) {
  const parts = [
    lessons ? `${withCount(lessons, DAYS)} уроков` : "уроков нет",
    reviews ? `повторение ${withCount(reviews, DAYS)}` : "",
    goal ? "цель недели выполнена" : "",
  ];
  return `Неделя с ${dayMonth(monday)}: ${parts.filter(Boolean).join(", ")}`;
}

export function Weeks({
  data,
  pausedAt,
  timezone,
  summary,
  level,
}: {
  data: Pick<CourseProgress, "days" | "week">;
  pausedAt?: string;
  timezone: string;
  summary: string;
  level: 2 | 3;
}) {
  const heading = useId();
  const Heading = level === 2 ? "h2" : "h3";
  const scroller = useRef<HTMLDivElement>(null);
  const { today } = data.week;
  const weeks = weekGrid(data.days, today, pausedAt && studyDay(new Date(pausedAt), timezone));
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks.length]);
  return (
    <section aria-labelledby={heading} data-testid="weeks">
      <Heading id={heading} className={css.heading}>
        Занятия по неделям
      </Heading>
      {weeks.length > 0 && (
        <>
          <p className={css.note}>Ориентир — 2–3 занятия в неделю.</p>
          <div className={css.weekGrid}>
            <div className={css.axis} aria-hidden>
              {DAY_LABELS.map((label, index) => (
                <span key={index}>{label}</span>
              ))}
            </div>
            <div ref={scroller} className={css.weekScroll} tabIndex={0} aria-label="Недели с начала занятий">
              <ol className={css.weekList}>
                {weeks.map((week) => (
                  <li key={week.monday} className={css.weekColumn}>
                    <span className={css.month} aria-hidden>
                      {week.month !== undefined ? MONTHS[week.month] : ""}
                    </span>
                    {week.days.map((day) => (
                      <i
                        key={day.day}
                        aria-hidden
                        className={cx(
                          css.day,
                          day.lesson && css.dayLesson,
                          day.review && css.dayReview,
                          day.today && css.dayToday,
                          day.future && css.dayFuture,
                          day.paused && css.dayPaused,
                        )}
                      />
                    ))}
                    <span className={css.goal} aria-hidden>
                      {week.goal ? "✓" : ""}
                    </span>
                    <span className="sr-only">{weekLabel(week.monday, week.lessons, week.reviews, week.goal)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <p className={css.legend} aria-hidden>
            <span>
              <i className={cx(css.day, css.dayLesson)} />
              урок
            </span>
            <span>
              <i className={cx(css.day, css.dayReview)} />
              повторение
            </span>
            {weeks.some((week) => week.days.some((day) => day.paused)) && (
              <span>
                <i className={cx(css.day, css.dayPaused)} />
                пауза
              </span>
            )}
            <span>
              <b className={css.goal}>✓</b> 2+ занятия за неделю
            </span>
          </p>
        </>
      )}
      <p className={cx(css.weekLine, weeks.length > 0 && css.weekLineNear)} data-testid="week">
        {summary}
      </p>
    </section>
  );
}
