import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import {
  courses,
  currentCourse,
  homeCourse,
  primaryCourse,
  rememberCourses,
  setPrimaryCourse,
  todayCourse,
} from "../src/storage/courses";
import {
  COURSE_PAUSES_KEY,
  mergePauses,
  parsePauses,
  PAUSES_MARK_KEY,
  readPauses,
  type CoursePause,
} from "../src/storage/pauses";
import { pauseCourse, resumeCourse } from "../src/storage/pause-actions";
import { DIRTY_KEY } from "../src/storage/ops";
import { dexieSource } from "../src/storage/queries";
import { pausedSince } from "../src/shared/format";

const A = "greek-a2";
const B = "english";
const C = "travel";
const iso = "2026-10-01T09:00:00.000Z";
let db: AppDatabase;

beforeEach(async () => {
  await new AppDatabase("tetradio-course-pause").delete();
  db = new AppDatabase("tetradio-course-pause");
  for (const [index, id] of [A, B, C].entries()) {
    await db.courses.add({ id, title: id, updatedAt: iso });
    await db.lessons.add({
      id: `${id}-1`,
      courseId: id,
      title: "1",
      completed: true,
      updatedAt: `2026-10-0${index + 1}T09:00:00.000Z`,
    });
    await rememberCourses(db);
  }
});
afterEach(() => db.close());

const at = (time: string) => new Date(time);

describe("запись паузы", () => {
  it("пауза пишет запись и отметку пауз, но не отметку неопубликованных изменений", async () => {
    await pauseCourse(B, at("2026-10-12T09:00:00Z"), db);
    expect(await readPauses(db)).toEqual({
      [B]: { pausedAt: "2026-10-12T09:00:00.000Z", resumedAt: null, updatedAt: "2026-10-12T09:00:00.000Z" },
    });
    expect((await db.meta.get(PAUSES_MARK_KEY))?.value).toBeTruthy();
    expect(await db.meta.get(DIRTY_KEY)).toBeUndefined();
    expect((await courses(db)).find((course) => course.id === B)?.pausedAt).toBe("2026-10-12T09:00:00.000Z");
  });
  it("возврат — без даты паузы, с датой возврата", async () => {
    await pauseCourse(B, at("2026-10-12T09:00:00Z"), db);
    await resumeCourse(B, at("2026-10-20T09:00:00Z"), db);
    expect((await readPauses(db))[B]).toEqual({
      pausedAt: null,
      resumedAt: "2026-10-20T09:00:00.000Z",
      updatedAt: "2026-10-20T09:00:00.000Z",
    });
    expect((await courses(db)).find((course) => course.id === B)?.pausedAt).toBeUndefined();
  });
  it("отстающие часы — изменение на 1 мс позже известной записи", async () => {
    await pauseCourse(B, at("2026-10-12T10:00:00Z"), db);
    await resumeCourse(B, at("2026-10-12T09:00:00Z"), db);
    expect((await readPauses(db))[B]).toEqual({
      pausedAt: null,
      resumedAt: "2026-10-12T09:00:00.000Z",
      updatedAt: "2026-10-12T10:00:00.001Z",
    });
  });
  it("время записи приводится к ISO", () => {
    expect(
      parsePauses(
        JSON.stringify({
          [B]: { pausedAt: "2026-10-12T12:00:00+03:00", resumedAt: null, updatedAt: "2026-10-12T09:00Z" },
        }),
      ),
    ).toEqual({
      [B]: { pausedAt: "2026-10-12T09:00:00.000Z", resumedAt: null, updatedAt: "2026-10-12T09:00:00.000Z" },
    });
  });
  it("испорченная запись — нет паузы", async () => {
    expect(parsePauses("{")).toEqual({});
    expect(parsePauses(JSON.stringify({ [B]: { pausedAt: iso, resumedAt: null } }))).toEqual({});
    expect(parsePauses(JSON.stringify({ [B]: { pausedAt: "вчера", resumedAt: null, updatedAt: iso } }))).toEqual({});
    await db.meta.put({ key: COURSE_PAUSES_KEY, value: "[1]" });
    expect((await courses(db)).every((course) => !course.pausedAt)).toBe(true);
  });
  it("слияние — по более позднему изменению, при равном времени одинаково в любом порядке", () => {
    const paused: CoursePause = { pausedAt: iso, resumedAt: null, updatedAt: iso };
    const resumed: CoursePause = { pausedAt: null, resumedAt: iso, updatedAt: iso };
    const later: CoursePause = { pausedAt: null, resumedAt: iso, updatedAt: "2026-10-02T09:00:00.000Z" };
    expect(mergePauses({ [B]: paused }, { [B]: later })).toEqual({ [B]: later });
    expect(mergePauses({ [B]: later }, { [B]: paused })).toEqual({ [B]: later });
    expect(mergePauses({ [B]: paused }, { [B]: resumed })).toEqual(mergePauses({ [B]: resumed }, { [B]: paused }));
    expect(mergePauses({ [A]: paused }, undefined, { [B]: resumed })).toEqual({ [A]: paused, [B]: resumed });
  });
});

describe("курс «Сегодня»", () => {
  it("основной на паузе — следующий по порядку; основной и курс экранов не меняются", async () => {
    await setPrimaryCourse(A, db);
    await pauseCourse(A, at("2026-10-12T09:00:00Z"), db);
    expect(await todayCourse(db)).toBe(B);
    expect(await primaryCourse(db)).toBe(A);
    expect(await homeCourse(db)).toBe(A);
    expect(await currentCourse(db)).toBe(A);
  });
  it("по кругу: основной — последний по порядку", async () => {
    await setPrimaryCourse(C, db);
    await pauseCourse(C, at("2026-10-12T09:00:00Z"), db);
    expect(await todayCourse(db)).toBe(A);
  });
  it("без явного выбора отсчёт от начатого первым", async () => {
    await pauseCourse(A, at("2026-10-12T09:00:00Z"), db);
    expect(await todayCourse(db)).toBe(B);
  });
  it("возврат основного — снова он", async () => {
    await setPrimaryCourse(B, db);
    await pauseCourse(B, at("2026-10-12T09:00:00Z"), db);
    expect(await todayCourse(db)).toBe(C);
    await resumeCourse(B, at("2026-10-13T09:00:00Z"), db);
    expect(await todayCourse(db)).toBe(B);
  });
  it("все на паузе — курса «Сегодня» нет", async () => {
    for (const id of [A, B, C]) await pauseCourse(id, at("2026-10-12T09:00:00Z"), db);
    expect(await todayCourse(db)).toBeUndefined();
    expect(await primaryCourse(db)).toBe(A);
  });
});

describe("пауза в источнике плана", () => {
  it("отдаёт запись курса; без записи — ничего", async () => {
    await pauseCourse(B, at("2026-10-12T09:00:00Z"), db);
    const source = dexieSource(db);
    expect((await source.pauseOf!(B))?.pausedAt).toBe("2026-10-12T09:00:00.000Z");
    expect(await source.pauseOf!(A)).toBeUndefined();
  });
});

describe("дата паузы", () => {
  const now = new Date("2026-10-20T09:00:00Z");
  it("день и месяц в текущем году, с годом — в прошлом, не позже сегодняшнего", () => {
    expect(pausedSince("2026-10-12T09:00:00Z", now, "Asia/Nicosia")).toBe("12 октября");
    expect(pausedSince("2025-01-03T09:00:00Z", now, "Asia/Nicosia")).toBe("3 января 2025");
    expect(pausedSince("2026-10-25T09:00:00Z", now, "Asia/Nicosia")).toBe("20 октября");
    expect(pausedSince("2026-10-11T22:30:00Z", now, "Asia/Nicosia")).toBe("12 октября");
  });
});
