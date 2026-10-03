import { describe, expect, it } from "vitest";
import { coursePace, type ModuleLoad } from "../src/domain/progress";

/** 24 модуля по 4 урока, K1 после 8-го: к 13 декабря — 32 урока. */
const modules = (done: number): ModuleLoad[] =>
  Array.from({ length: 24 }, (_, index) => ({
    number: index + 1,
    lessons: 4,
    done: Math.max(0, Math.min(4, done - index * 4)),
  }));

describe("темп курса против календаря", () => {
  it("в день старта план — ноль, отставания нет, ближайшая точка — K1", () => {
    const pace = coursePace(modules(0), "2026-10-05", []);
    expect(pace.planned).toBe(0);
    expect(pace.lagWeeks).toBe(0);
    expect(pace.next?.checkpoint.label).toBe("K1");
    expect(pace.next?.remaining).toBe(32);
  });
  it("к середине отрезка до K1 план — половина уроков; недобор даёт отставание в неделях", () => {
    const pace = coursePace(modules(8), "2026-11-08", []);
    expect(pace.planned).toBe(16);
    expect(pace.lagWeeks).toBe(3); // 8 уроков при плане 32 за 10 недель — 3,2 в неделю
    expect(pace.next?.perWeek).toBe(4.8); // 24 урока за 5 недель до 13 декабря
  });
  it("впереди плана — без отставания", () => {
    expect(coursePace(modules(20), "2026-11-08", []).lagWeeks).toBe(0);
  });
  it("после K1 план идёт к M1, точка K1 пройдена", () => {
    const pace = coursePace(modules(32), "2026-12-20", []);
    expect(pace.next?.checkpoint.label).toBe("M1");
    expect(pace.planned).toBeGreaterThan(32);
  });
  it("темп последних четырёх недель — уроки в неделю", () => {
    const pace = coursePace(modules(8), "2026-11-08", [
      "2026-10-06",
      "2026-10-20",
      "2026-10-27",
      "2026-11-03",
      "2026-11-05",
    ]);
    expect(pace.recentPerWeek).toBe(1); // 6 октября — раньше 28 дней
  });
});
