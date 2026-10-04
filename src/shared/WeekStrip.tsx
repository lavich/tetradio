import { addDays } from "../domain/learning";
import { cx } from "./cx";
import css from "./week.module.css";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
/** Ориентир курса — 2–3 занятия в неделю; клеток недели не меньше трёх. */
export const WEEK_PLAN = 3;

/** Неделя клетками Пн–Вс: залитая — день урока, в рамке — сегодня, точка — день повторения. */
export function WeekStrip({
  monday,
  today,
  lessons,
  reviews = [],
  small,
  className,
  label,
}: {
  monday: string;
  today: string;
  lessons: string[];
  reviews?: string[];
  small?: boolean;
  className?: string;
  label: (name: string, lesson: boolean, review: boolean) => string;
}) {
  return (
    <div className={cx(css.days, small && css.small, className)} role="list" aria-label="Дни недели">
      {WEEKDAYS.map((name, index) => {
        const day = addDays(monday, index);
        const lesson = lessons.includes(day);
        const review = reviews.includes(day);
        return (
          <span key={name} role="listitem" className={cx(css.day, lesson && css.lesson, day === today && css.today)}>
            <span aria-hidden>{name}</span>
            <span className="sr-only">{label(name, lesson, review)}</span>
            {review && <i className={css.review} aria-hidden />}
          </span>
        );
      })}
    </div>
  );
}
