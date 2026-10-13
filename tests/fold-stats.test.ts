import { describe, expect, it } from "vitest";
import { emptyStats, foldStats, RECENT, succeeded, type StatsSummary } from "../src/domain/skills";
import type { ExerciseType, ReviewEvent } from "../src/domain/types";

type Event = Pick<ReviewEvent, "type" | "correct" | "rating" | "unitKey" | "localDate">;
/** Свёртка по одному ответу, как до перехода на множества: эталон эквивалентности. */
function foldOne(summary: StatsSummary, event: Event, keepDays: number): StatsSummary {
  const days = summary.days.some((day) => day.date === event.localDate)
    ? summary.days.map((day) =>
        day.date === event.localDate
          ? {
              ...day,
              answers: day.answers + 1,
              keys: day.keys.includes(event.unitKey) ? day.keys : [...day.keys, event.unitKey],
            }
          : day,
      )
    : [...summary.days, { date: event.localDate, answers: 1, keys: [event.unitKey] }];
  return {
    days: days.sort((a, b) => a.date.localeCompare(b.date)).slice(-keepDays),
    recentByType: {
      ...summary.recentByType,
      [event.type]: [...(summary.recentByType[event.type] ?? []), succeeded(event)].slice(-RECENT),
    },
    answers: summary.answers + 1,
    answeredKeys: summary.answeredKeys.includes(event.unitKey)
      ? summary.answeredKeys
      : [...summary.answeredKeys, event.unitKey],
  };
}
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}
const TYPES: ExerciseType[] = ["recognition", "assembly", "spelling", "listening"];

describe("свёртка статистики", () => {
  it("совпадает с поответной свёрткой: дни, ключи, последние исходы и итоги", () => {
    for (const seed of [1, 7, 42]) {
      const next = random(seed);
      // Дни идут не строго по порядку: смена часового пояса возвращает вчерашнюю дату.
      const events: Event[] = Array.from({ length: 400 }, (_, index) => ({
        type: TYPES[Math.floor(next() * TYPES.length)],
        correct: next() < 0.1 ? null : next() < 0.7,
        rating: 1 + Math.floor(next() * 4),
        unitKey: `k${Math.floor(next() * 60)}`,
        localDate: `2026-09-${String(1 + Math.floor(index / 20) - (next() < 0.05 ? 1 : 0) + 1).padStart(2, "0")}`,
      }));
      const base: StatsSummary = {
        days: [{ date: "2026-09-01", answers: 3, keys: ["k1", "k2"] }],
        recentByType: { spelling: [true, false] },
        answers: 3,
        answeredKeys: ["k1", "k2"],
      };
      for (const keepDays of [14, Infinity]) {
        const expected = events.reduce((summary, event) => foldOne(summary, event, keepDays), base);
        expect(foldStats(base, events, keepDays)).toEqual(expected);
      }
      expect(foldStats(emptyStats(), [], 14)).toEqual(emptyStats());
    }
  });
});
