import { describe, expect, it } from "vitest";
import type { LessonBlock } from "../src/content/course";
import { coursePace, skillProgress, type ModuleLoad } from "../src/domain/progress";
import type { BlockProgress } from "../src/domain/types";
import { GREEK_CALENDAR } from "./helpers/calendar";

/** 24 модуля по 4 урока, K1 после 8-го: к 13 декабря — 32 урока. */
const modules = (done: number): ModuleLoad[] =>
  Array.from({ length: 24 }, (_, index) => ({
    number: index + 1,
    lessons: 4,
    done: Math.max(0, Math.min(4, done - index * 4)),
  }));

describe("темп курса против календаря", () => {
  it("в день старта план — ноль, отставания нет, ближайшая точка — K1", () => {
    const pace = coursePace(modules(0), "2026-10-05", [], GREEK_CALENDAR);
    expect(pace.planned).toBe(0);
    expect(pace.lagWeeks).toBe(0);
    expect(pace.next?.checkpoint.label).toBe("K1");
    expect(pace.next?.remaining).toBe(32);
  });
  it("к середине отрезка до K1 план — половина уроков; недобор даёт отставание в неделях", () => {
    const pace = coursePace(modules(8), "2026-11-08", [], GREEK_CALENDAR);
    expect(pace.planned).toBe(16);
    expect(pace.lagWeeks).toBe(3); // 8 уроков при плане 32 за 10 недель — 3,2 в неделю
    expect(pace.next?.perWeek).toBe(4.8); // 24 урока за 5 недель до 13 декабря
  });
  it("впереди плана — без отставания", () => {
    expect(coursePace(modules(20), "2026-11-08", [], GREEK_CALENDAR).lagWeeks).toBe(0);
  });
  it("после K1 план идёт к M1, точка K1 пройдена", () => {
    const pace = coursePace(modules(32), "2026-12-20", [], GREEK_CALENDAR);
    expect(pace.next?.checkpoint.label).toBe("M1");
    expect(pace.planned).toBeGreaterThan(32);
  });
  it("темп последних четырёх недель — уроки в неделю", () => {
    const pace = coursePace(
      modules(8),
      "2026-11-08",
      ["2026-10-06", "2026-10-20", "2026-10-27", "2026-11-03", "2026-11-05"],
      GREEK_CALENDAR,
    );
    expect(pace.recentPerWeek).toBe(1); // 6 октября — раньше 28 дней
  });
  it("темп считается с первого пройденного урока, а не всегда за четыре недели", () => {
    const pace = coursePace(
      modules(6),
      "2026-10-18",
      ["2026-10-05", "2026-10-08", "2026-10-11", "2026-10-15"],
      GREEK_CALENDAR,
    );
    expect(pace.recentPerWeek).toBe(2); // 4 урока за 14 дней
  });
  it("меньше недели истории — темпа нет", () => {
    expect(
      coursePace(modules(3), "2026-10-07", ["2026-10-05", "2026-10-06", "2026-10-07"], GREEK_CALENDAR).recentPerWeek,
    ).toBeNull();
    expect(coursePace(modules(0), "2026-10-07", [], GREEK_CALENDAR).recentPerWeek).toBeNull();
  });
  it("без календаря плана нет: план равен пройденному, точки нет, темп считается", () => {
    const pace = coursePace(
      modules(8),
      "2026-11-08",
      ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-05"],
      undefined,
    );
    expect(pace).toMatchObject({ done: 8, total: 96, planned: 8, lagWeeks: 0, next: null });
    expect(pace.recentPerWeek).toBe(1.4);
  });
  it("точки другого курса задают план, точки греческого на него не влияют", () => {
    const other = {
      start: "2026-11-01",
      checkpoints: [{ label: "B1", title: "Проверка B1", afterModule: 4, date: "2026-11-29" }],
    };
    const pace = coursePace(modules(4), "2026-11-15", [], other);
    expect(pace.planned).toBe(8); // половина из 16 уроков до B1
    expect(pace.lagWeeks).toBe(1); // 4 урока при плане 4 в неделю
    expect(pace.next).toMatchObject({ checkpoint: { label: "B1" }, remaining: 12, perWeek: 6 });
    expect(coursePace(modules(16), "2026-12-20", [], other)).toMatchObject({ planned: 96, next: null });
  });
});

describe("навыки по всему курсу", () => {
  const blocks: LessonBlock[] = [
    { type: "reading", id: "text", title: "Текст", body: "" } as unknown as LessonBlock,
    {
      type: "exercise",
      id: "about-text",
      about: "text",
      format: "choice",
      items: [{}, {}, {}, {}],
    } as unknown as LessonBlock,
    { type: "exercise", id: "grammar", format: "choice", items: [{}, {}] } as unknown as LessonBlock,
    { type: "writing", id: "letter", criteria: ["a", "b", "c", "d"] } as unknown as LessonBlock,
  ];
  const mark = (patch: Partial<BlockProgress>) => ({ done: true, ...patch }) as BlockProgress;
  it("доля — верное из всего курса, качество — верное из выполненного", () => {
    const skills = skillProgress([
      {
        blocks,
        progress: new Map([
          ["about-text", mark({ score: { correct: 2, almost: 1, total: 4 } })],
          ["letter", mark({ checks: [0, 1, 2] })],
        ]),
      },
      { blocks, progress: new Map() },
    ]);
    const reading = skills.find((item) => item.skill === "reading")!;
    expect(reading).toMatchObject({ earned: 3, attempted: 4, total: 8, source: "task" });
    expect(skills.find((item) => item.skill === "writing")).toMatchObject({
      earned: 3,
      attempted: 4,
      total: 8,
      source: "self",
    });
    // Задание без текста (грамматика) в навыки не входит.
    expect(skills.find((item) => item.skill === "listening")).toMatchObject({ earned: 0, total: 0 });
  });
});
