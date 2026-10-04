import { CHECKPOINTS as POINTS } from "../../domain/progress";
import { dayMonth } from "../../shared/format";

/** Подписи контрольных точек на полке: «Контрольная A1 · 13 декабря» — из календаря курса, как на экране прогресса. */
export const CHECKPOINTS: Record<number, string> = Object.fromEntries(
  POINTS.map((point) => [point.afterModule, `${point.title} · ${dayMonth(point.date)}`]),
);
