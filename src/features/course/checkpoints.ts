import type { CourseCalendar } from "../../content/course";
import { dayMonth } from "../../shared/format";

/** Подписи контрольных точек по номеру модуля: «Контрольная A1 · 13 декабря» — из календаря курса. */
export const checkpointLabels = (calendar: CourseCalendar | undefined): Record<number, string> =>
  Object.fromEntries(
    (calendar?.checkpoints ?? []).map((point) => [point.afterModule, `${point.title} · ${dayMonth(point.date)}`]),
  );
