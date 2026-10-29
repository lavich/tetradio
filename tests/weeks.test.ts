import { describe, expect, it } from "vitest";
import { weekGrid } from "../src/domain/weeks";

describe("сетка занятий по неделям", () => {
  it("без дней уроков и повторения сетки нет", () => {
    expect(weekGrid({ lessons: [], reviews: [] }, "2026-10-27")).toEqual([]);
  });

  it("недели — от понедельника первого дня до текущей; будущие дни пустые", () => {
    const weeks = weekGrid(
      { lessons: ["2026-10-13", "2026-10-15"], reviews: ["2026-10-14", "2026-10-27"] },
      "2026-10-27",
    );
    expect(weeks.map((week) => week.monday)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(weeks[0]).toMatchObject({ lessons: 2, reviews: 1, goal: true });
    expect(weeks[1]).toMatchObject({ lessons: 0, reviews: 0, goal: false });
    const current = weeks[2].days;
    expect(current[1]).toMatchObject({ day: "2026-10-27", today: true, review: true, future: false });
    expect(current.slice(2).every((day) => day.future)).toBe(true);
  });

  it("цель недели — два дня уроков; дни повторения не в счёт", () => {
    const [week] = weekGrid({ lessons: ["2026-10-20"], reviews: ["2026-10-21", "2026-10-22"] }, "2026-10-25");
    expect(week).toMatchObject({ lessons: 1, reviews: 2, goal: false });
  });

  it("пауза штрихует пустые дни с её начала до сегодня", () => {
    const [week] = weekGrid({ lessons: ["2026-10-19"], reviews: ["2026-10-22"] }, "2026-10-23", "2026-10-21");
    expect(week.days.map((day) => day.paused)).toEqual([false, false, true, false, true, false, false]);
  });

  it("месяц подписан у первой недели месяца; первая колонка — только если следующая того же месяца", () => {
    const late = weekGrid({ lessons: ["2026-09-28"], reviews: [] }, "2026-10-13");
    expect(late.map((week) => week.month)).toEqual([undefined, 9, undefined]);
    const early = weekGrid({ lessons: ["2026-09-07"], reviews: [] }, "2026-10-06");
    expect(early.map((week) => week.month)).toEqual([8, undefined, undefined, undefined, 9]);
  });

  it("в понедельник у текущей недели одна прошедшая клетка и шесть будущих", () => {
    const weeks = weekGrid({ lessons: ["2026-10-26"], reviews: [] }, "2026-10-26");
    expect(weeks).toHaveLength(1);
    expect(weeks[0].days.map((day) => day.future)).toEqual([false, true, true, true, true, true, true]);
    expect(weeks[0].days[0]).toMatchObject({ today: true, lesson: true });
  });

  it("в воскресенье будущих клеток нет", () => {
    const [week] = weekGrid({ lessons: ["2026-10-20"], reviews: [] }, "2026-10-25");
    expect(week.days.some((day) => day.future)).toBe(false);
    expect(week.days[6].today).toBe(true);
  });

  it("пауза, начатая раньше первой недели, штрихует все пустые прошедшие дни", () => {
    const [week] = weekGrid({ lessons: [], reviews: ["2026-10-21"] }, "2026-10-23", "2026-09-01");
    expect(week.days.map((day) => day.paused)).toEqual([true, true, false, true, true, false, false]);
  });

  it("дни только в будущем, например после смены пояса, сетки не дают", () => {
    expect(weekGrid({ lessons: ["2026-10-28"], reviews: ["2026-10-29"] }, "2026-10-27")).toEqual([]);
  });

  it("через новый год январь подписан у первой недели января", () => {
    const weeks = weekGrid({ lessons: ["2026-12-14"], reviews: [] }, "2027-01-12");
    expect(weeks.map((week) => week.monday)).toEqual([
      "2026-12-14",
      "2026-12-21",
      "2026-12-28",
      "2027-01-04",
      "2027-01-11",
    ]);
    expect(weeks.map((week) => week.month)).toEqual([11, undefined, undefined, 0, undefined]);
  });
});
