import { useId, useLayoutEffect, useRef, useState } from "react";
import { studyDay } from "../../domain/time";
import { weekGrid, type GridWeek } from "../../domain/weeks";
import { cx } from "../../shared/cx";
import { dayMonth, withCount } from "../../shared/format";
import type { CourseProgress } from "../../storage/progress";
import css from "./progress.module.css";

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const DAY_LABELS = ["Пн", "", "Ср", "", "Пт", "", "Вс"];
const DAYS: [string, string, string] = ["день", "дня", "дней"];
/** Ширина столбца недели с зазором — как в progress.module.css. */
const STEP = 20;
const GAP = 4;

function weekLabel(week: GridWeek, current: boolean) {
  const parts = [
    week.lessons ? `уроки в ${withCount(week.lessons, DAYS)}` : "уроков нет",
    week.reviews ? `повторение ${withCount(week.reviews, DAYS)}` : "",
    week.days.some((day) => day.paused) ? "пауза" : "",
    week.goal ? "ориентир недели выполнен" : "",
  ];
  return `${current ? "Эта неделя" : `Неделя с ${dayMonth(week.monday)}`}: ${parts.filter(Boolean).join(", ")}`;
}

const columns = (width: number) => Math.floor((width + GAP) / STEP) * STEP - GAP;

export function Weeks({
  data,
  pausedAt,
  timezone,
  summary,
  language,
  level,
}: {
  data: Pick<CourseProgress, "days" | "week">;
  pausedAt?: string;
  timezone: string;
  summary: string;
  language: boolean;
  level: 2 | 3;
}) {
  const heading = useId();
  const Heading = level === 2 ? "h2" : "h3";
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const [scrollable, setScrollable] = useState(false);
  const { today } = data.week;
  const weeks = weekGrid(data.days, today, pausedAt && studyDay(new Date(pausedAt), timezone));
  useLayoutEffect(() => {
    const [box, area, content] = [frame.current, scroller.current, list.current];
    if (!box || !area || !content) return;
    // Видимая ширина — целое число столбцов: иначе прижатая к концу сетка режет левый столбец и подпись месяца.
    const fit = () => {
      content.style.minWidth = "";
      const full = Math.ceil((content.scrollWidth + GAP) / STEP) * STEP - GAP;
      content.style.minWidth = `${full}px`;
      const visible = Math.min(full, Math.max(columns(box.clientWidth), STEP - GAP));
      area.style.width = `${visible}px`;
      setScrollable(full > visible);
      if (pinned.current) area.scrollLeft = area.scrollWidth;
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(box);
    return () => observer?.disconnect();
  }, [weeks.length]);
  const first = weeks[0]?.days.find((day) => day.lesson || day.review)?.day;
  return (
    <section aria-labelledby={heading} data-testid="weeks">
      <Heading id={heading} className={css.heading}>
        Занятия по неделям
      </Heading>
      {weeks.length > 0 && (
        <>
          <p className={css.note}>
            {first && `С начала ${language ? "занятий" : "курса"}, ${dayMonth(first)}. `}Ориентир — 2–3 занятия в
            неделю.
          </p>
          <div className={css.weekGrid}>
            <div className={css.axis} aria-hidden>
              {DAY_LABELS.map((label, index) => (
                <span key={index}>{label}</span>
              ))}
            </div>
            <div ref={frame} className={css.weekFrame}>
              <div
                ref={scroller}
                className={css.weekScroll}
                role="region"
                aria-label="Недели с начала занятий"
                tabIndex={scrollable ? 0 : undefined}
                onScroll={(event) => {
                  const area = event.currentTarget;
                  // Пока окно сужается, а ширина ещё не подогнана, браузер сдвигает прокрутку сам — это не выбор учащегося.
                  if (area.clientWidth !== parseFloat(area.style.width)) return;
                  pinned.current = area.scrollLeft + area.clientWidth >= area.scrollWidth - 1;
                }}
              >
                <ol ref={list} className={css.weekList} role="list">
                  {weeks.map((week, index) => (
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
                      <span className="sr-only">{weekLabel(week, index === weeks.length - 1)}</span>
                    </li>
                  ))}
                </ol>
              </div>
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
