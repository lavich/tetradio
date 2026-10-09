import { describe, expect, it } from "vitest";
import { checkpointLabels } from "../src/features/course/checkpoints";
import { GREEK_CALENDAR } from "./helpers/calendar";

describe("подписи контрольных точек на полке", () => {
  it("берут даты из календаря курса, как экран прогресса", () => {
    expect(checkpointLabels(GREEK_CALENDAR)).toEqual({
      8: "Контрольная A1 · 13 декабря",
      15: "Пробник M1 · 13 февраля",
      20: "Пробник M2 · 29 марта",
      24: "Пробник M3 · 2 мая",
    });
  });
  it("у курса без календаря подписей нет", () => {
    expect(checkpointLabels(undefined)).toEqual({});
  });
});
