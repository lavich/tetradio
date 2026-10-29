import { isPlanned } from "./kinds";
import type { ReviewEvent } from "./types";

/** Учебные дни плановых повторений по курсам: курс → дни по порядку, без повторов. */
export type ReviewDays = Record<string, string[]>;

export const isReviewDay = (event: Pick<ReviewEvent, "mode" | "ref">) =>
  event.mode !== "practice" && isPlanned(event.ref);

export function mergeReviewDays(...sources: (ReviewDays | undefined)[]): ReviewDays {
  const merged = new Map<string, Set<string>>();
  for (const source of sources)
    for (const [course, days] of Object.entries(source ?? {})) {
      const set = merged.get(course) ?? new Set<string>();
      for (const day of days) set.add(day);
      merged.set(course, set);
    }
  return Object.fromEntries(
    [...merged]
      .filter(([, days]) => days.size)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([course, days]) => [course, [...days].sort()]),
  );
}

/** Дни событий по курсу карточки; событие без курса в `owner` не учитывается. */
export function reviewDaysOf(
  events: Pick<ReviewEvent, "mode" | "ref" | "unitKey" | "localDate">[],
  owner: Map<string, string>,
): ReviewDays {
  const days: ReviewDays = {};
  for (const event of events) {
    const course = owner.get(event.unitKey);
    if (course && isReviewDay(event) && isDay(event.localDate)) (days[course] ??= []).push(event.localDate);
  }
  return mergeReviewDays(days);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
export const dayNumber = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / DAY_MS;
export const dayOfNumber = (number: number) => new Date(number * DAY_MS).toISOString().slice(0, 10);
/** Дни навсегда остаются в наборе: день со сбитых часов растянул бы сетку на десятилетия или испортил поле. */
export const isDay = (day: unknown): day is string =>
  typeof day === "string" &&
  DAY.test(day) &&
  day >= "2020-01-01" &&
  day < "2100-01-01" &&
  dayOfNumber(dayNumber(day)) === day;

/** Дни из базы или копии: всё, что не похоже на набор дней, отбрасывается. */
export function readReviewDays(value: unknown): ReviewDays {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const days: ReviewDays = {};
  for (const [course, list] of Object.entries(value)) if (Array.isArray(list)) days[course] = list.filter(isDay);
  return mergeReviewDays(days);
}
