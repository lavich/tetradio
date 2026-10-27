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
});
