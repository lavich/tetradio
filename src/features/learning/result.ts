import type { ReviewEvent } from "../../domain/types";
import { minutes, plural, withCount } from "../../shared/format";
import { markOf, type DoneRow } from "./notebook";

export type CellKind = "clean" | "almost" | "wrong";

export const isMistake = (event: Pick<ReviewEvent, "correct" | "rating">) =>
  event.correct === false || (event.correct === null && event.rating === 1);

export function cardOutcomes(events: ReviewEvent[]) {
  const kinds = new Map<string, CellKind>();
  for (const event of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const current = kinds.get(event.unitKey) ?? "clean";
    if (!isMistake(event)) {
      kinds.set(event.unitKey, current);
      continue;
    }
    kinds.set(event.unitKey, current === "wrong" || markOf(event) !== "almost" ? "wrong" : "almost");
  }
  const corrected = new Set([...kinds].filter(([, kind]) => kind !== "clean").map(([key]) => key));
  return { cells: [...kinds.values()], corrected, clean: kinds.size - corrected.size };
}

export function splitRows(rows: DoneRow[], corrected: Set<string>) {
  const skipped = rows.filter((row) => row.mark === "skipped");
  const fixed = rows.filter((row) => row.mark !== "skipped" && corrected.has(row.unitKey));
  const clean = rows.filter((row) => row.mark !== "skipped" && !corrected.has(row.unitKey));
  return { fixed, skipped, clean, fixedCards: new Set(fixed.map((row) => row.unitKey)).size };
}

const ANSWERS: [string, string, string] = ["ответ", "ответа", "ответов"];
const CHECKED: [string, string, string] = ["проверяемому", "проверяемым", "проверяемым"];
export function answersLine(events: Pick<ReviewEvent, "correct">[], activeTimeMs: number) {
  const objective = events.filter((event) => event.correct !== null);
  const accuracy = objective.length
    ? `точность ${Math.round((objective.filter((event) => event.correct).length / objective.length) * 100)}%${
        objective.length < events.length ? ` по ${objective.length} ${plural(objective.length, CHECKED)}` : ""
      }`
    : "самооценка, точности нет";
  return [withCount(events.length, ANSWERS), accuracy, minutes(activeTimeMs)].join(" · ");
}

export const NAMES_SHOWN = 6;
export const limitNames = (names: string[]) => ({
  shown: names.slice(0, NAMES_SHOWN),
  rest: Math.max(0, names.length - NAMES_SHOWN),
});
