import { describe, expect, it } from "vitest";
import { localHour, preparedThrough } from "../src/domain/learning";
import { lessonOrder, nextLessonDay, scheduleLessons } from "../src/domain/schedule";
import { fillSchedule } from "../src/domain/types";
import type { Lesson, Schedule } from "../src/domain/types";

const created = "2026-09-01T09:00:00Z";
const lesson = (id: string, title: string, over: Partial<Lesson> = {}): Lesson => ({
  id,
  title,
  targetDate: null,
  status: "upcoming",
  createdAt: created,
  updatedAt: created,
  ...over,
});
const monThu: Schedule = { startDate: "2026-09-14", weekdays: [1, 4], lessonHour: 12 };
const dates = (lessons: Lesson[], schedule: Schedule) =>
  Object.fromEntries(scheduleLessons(lessons, schedule).map((l) => [l.id, l.targetDate]));

describe("порядок уроков по номеру в названии", () => {
  it("сравнивает компоненты номера как числа, без номера — после, по дате создания и id", () => {
    const items = [
      lesson("b", "Повторение", { createdAt: "2026-09-02T00:00:00Z" }),
      lesson("c", "Урок 2.1"),
      lesson("d", "Урок 1.10"),
      lesson("e", "Урок 1.9"),
      lesson("a", "Повторение", { createdAt: "2026-09-02T00:00:00Z" }),
      lesson("f", "Разбор", { createdAt: "2026-09-01T00:00:00Z" }),
      lesson("g", "Урок 1"),
    ];
    expect([...items].sort(lessonOrder).map((l) => l.id)).toEqual(["g", "e", "d", "c", "f", "a", "b"]);
  });
});

describe("ближайший день расписания", () => {
  it("считает день недели по календарной строке", () => {
    expect(nextLessonDay("2026-09-18", [1, 4], true)).toBe("2026-09-21");
    expect(nextLessonDay("2026-09-21", [1, 4], true)).toBe("2026-09-21");
    expect(nextLessonDay("2026-09-21", [1, 4], false)).toBe("2026-09-24");
    expect(nextLessonDay("2026-09-27", [7], true)).toBe("2026-09-27");
  });
});

describe("даты уроков по расписанию", () => {
  const seed = [
    lesson("l11", "Урок 1.1", { status: "completed" }),
    lesson("l12", "Урок 1.2", { targetDate: "2026-09-18" }),
    lesson("l13", "Урок 1.3"),
    lesson("l14", "Урок 1.4"),
  ];
  it("сценарий спеки: 1.2 с датой 18 сентября, расписание Пн/Чт с 14 сентября", () => {
    expect(dates(seed, monThu)).toEqual({ l11: "2026-09-14", l12: "2026-09-18", l13: "2026-09-21", l14: "2026-09-24" });
    const scheduled = scheduleLessons(seed, monThu);
    expect(scheduled.map((l) => l.dateSource)).toEqual(["schedule", "manual", "schedule", "schedule"]);
    expect(scheduled.map((l) => l.id)).toEqual(seed.map((l) => l.id));
  });
  it("ручная дата сдвигает хвост", () => {
    const moved = seed.map((l) => (l.id === "l13" ? { ...l, targetDate: "2026-09-28" } : l));
    expect(dates(moved, monThu)).toMatchObject({ l13: "2026-09-28", l14: "2026-10-01" });
    expect(scheduleLessons(moved, monThu).find((l) => l.id === "l13")!.dateSource).toBe("manual");
  });
  it("курсор начинается с первого дня расписания не раньше даты первого занятия", () => {
    expect(
      dates([lesson("a", "Урок 1"), lesson("b", "Урок 2")], {
        startDate: "2026-09-19",
        weekdays: [2, 6],
        lessonHour: 12,
      }),
    ).toEqual({ a: "2026-09-19", b: "2026-09-22" });
  });
  it("ручная дата назад не двигает курсор назад и не занимает день", () => {
    const items = [
      lesson("a", "Урок 1", { targetDate: "2026-09-24" }),
      lesson("b", "Урок 2", { targetDate: "2026-09-10" }),
      lesson("c", "Урок 3"),
    ];
    expect(dates(items, monThu)).toEqual({ a: "2026-09-24", b: "2026-09-10", c: "2026-09-28" });
  });
  it("проведённый урок без даты получает день как остальные, проведённый с датой остаётся якорем", () => {
    const items = [
      lesson("a", "Урок 1", { status: "completed" }),
      lesson("b", "Урок 2", { status: "completed", targetDate: "2026-09-21" }),
      lesson("c", "Урок 3"),
    ];
    expect(dates(items, monThu)).toEqual({ a: "2026-09-14", b: "2026-09-21", c: "2026-09-24" });
  });
  it("уроки без номера идут после нумерованных", () => {
    const items = [
      lesson("r", "Повторение"),
      lesson("c", "Урок 2.1"),
      lesson("d", "Урок 1.10"),
      lesson("e", "Урок 1.9"),
    ];
    expect(dates(items, monThu)).toEqual({ e: "2026-09-14", d: "2026-09-17", c: "2026-09-21", r: "2026-09-24" });
  });
  it("без расписания даты не появляются, а ручные помечаются", () => {
    const off = { startDate: null, weekdays: [], lessonHour: 12 };
    const result = scheduleLessons(seed, off);
    expect(result.map((l) => l.targetDate)).toEqual([null, "2026-09-18", null, null]);
    expect(result.map((l) => l.dateSource)).toEqual([undefined, "manual", undefined, undefined]);
    expect(
      scheduleLessons(seed, { startDate: "2026-09-14", weekdays: [], lessonHour: 12 }).map((l) => l.targetDate),
    ).toEqual([null, "2026-09-18", null, null]);
  });
  it("не меняет исходные объекты", () => {
    scheduleLessons(seed, monThu);
    expect(seed[2].targetDate).toBeNull();
    expect("dateSource" in seed[1]).toBe(false);
  });
});

describe("час занятия в расписании", () => {
  it("подставляет полдень, когда часа нет или он невозможен", () => {
    expect(fillSchedule(undefined).lessonHour).toBe(12);
    expect(fillSchedule({ startDate: null, weekdays: [], lessonHour: 12 }).lessonHour).toBe(12);
    expect(fillSchedule({ ...monThu, lessonHour: 24 } as Schedule).lessonHour).toBe(12);
    expect(fillSchedule({ ...monThu, lessonHour: -1 } as Schedule).lessonHour).toBe(12);
    expect(fillSchedule({ ...monThu, lessonHour: 9.5 } as Schedule).lessonHour).toBe(12);
    expect(fillSchedule({ ...monThu, lessonHour: "9" } as unknown as Schedule).lessonHour).toBe(12);
  });
  it("сохраняет заданный час и остальные поля расписания", () => {
    const filled = fillSchedule({ ...monThu, lessonHour: 0 });
    expect(filled).toEqual({ startDate: "2026-09-14", weekdays: [1, 4], lessonHour: 0 });
  });
});

describe("местный час", () => {
  it("читает час в зоне пользователя, а не в UTC", () => {
    expect(localHour(new Date("2026-09-15T09:00:00Z"), "Asia/Nicosia")).toBe(12);
    expect(localHour(new Date("2026-09-15T09:00:00Z"), "UTC")).toBe(9);
    expect(localHour(new Date("2026-09-15T21:30:00Z"), "Asia/Nicosia")).toBe(0);
  });
});

describe("рубеж подготовки", () => {
  const nicosia = (iso: string, hour = 12) => preparedThrough(new Date(iso), "Asia/Nicosia", hour);
  it("до часа занятия сегодняшний день ещё не прошёл", () => {
    expect(nicosia("2026-09-15T06:00:00Z")).toBe("2026-09-14");
  });
  it("ровно в час занятия сегодняшний день уже прошёл", () => {
    expect(nicosia("2026-09-15T09:00:00Z")).toBe("2026-09-15");
  });
  it("после часа занятия сегодняшний день прошёл", () => {
    expect(nicosia("2026-09-15T15:45:00Z")).toBe("2026-09-15");
  });
  it("считает час каждого курса отдельно", () => {
    expect(nicosia("2026-09-15T07:00:00Z", 9)).toBe("2026-09-15");
    expect(nicosia("2026-09-15T07:00:00Z", 18)).toBe("2026-09-14");
  });
  it("полночь в зоне уже относится к новому дню", () => {
    expect(nicosia("2026-09-15T21:30:00Z", 0)).toBe("2026-09-16");
    expect(nicosia("2026-09-15T21:30:00Z", 12)).toBe("2026-09-15");
  });
});
