import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { AppDatabase } from "../src/storage/db";
import { lessonDays } from "../src/storage/course";
import { courseLessonIds } from "../src/storage/courses";
import { studiedLessons } from "../src/storage/queries";
import { markRead, moduleReadings, nextReading, readingPage } from "../src/storage/readings";
import { applySnapshot, describeSnapshot, readSnapshot } from "../src/sync/snapshot";
import { exportFull, restoreBackup } from "../src/features/backup/backup";
import { installLessons, memoryFetcher } from "./helpers/content";
import { installLesson } from "../src/content/client";

const demo = buildContent("tests/fixtures/course-demo");
const now = new Date("2026-10-12T09:00:00Z");
const fresh = async (name: string) => {
  const database = new AppDatabase(name);
  await database.delete();
  await database.open();
  return database;
};

describe("тексты для чтения на устройстве", () => {
  let db: AppDatabase;
  let course: string;
  beforeEach(async () => {
    db = await fresh("tetradio-readings");
    await installLessons(db, ["m01-1", "m01-test"], memoryFetcher(demo));
    course = (await db.lessons.get("m01-1"))!.courseId!;
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("текст открыт, когда открывающий урок пройден; задание урока его не открывает", async () => {
    const closed = await moduleReadings("m01", db);
    expect(closed.map((view) => [view.reading.id, view.open])).toEqual([
      ["r-m01-anna", false],
      ["r-m01-lemesos", false],
    ]);
    await db.blockProgress.put({
      key: "m01-1/forms",
      lessonId: "m01-1",
      blockId: "forms",
      done: true,
      updatedAt: now.toISOString(),
    });
    expect((await moduleReadings("m01", db))[0].open).toBe(false);
    await db.lessons.update("m01-1", { completed: true });
    expect((await moduleReadings("m01", db))[0]).toMatchObject({ open: true, after: { id: "m01-1" } });
    expect((await nextReading(course, db))?.reading.id).toBe("r-m01-anna");
    // Строка «Почитать» — только для текстов своего курса.
    expect(await nextReading("other-course", db)).toBeUndefined();
  });

  it("отметку «прочитано» можно поставить и снять; «Сегодня» предлагает только непрочитанное", async () => {
    await db.lessons.update("m01-1", { completed: true });
    await markRead("r-m01-anna", true, db);
    const page = (await readingPage("r-m01-anna", db))!;
    expect(page.readAt).toBeDefined();
    expect(page.next?.reading.id).toBe("r-m01-lemesos");
    expect(page.cards.size).toBeGreaterThan(0);
    expect(await nextReading(course, db)).toBeUndefined();
    await markRead("r-m01-anna", false, db);
    expect((await readingPage("r-m01-anna", db))!.readAt).toBeUndefined();
    expect((await nextReading(course, db))?.reading.id).toBe("r-m01-anna");
  });

  it("пакет, поставленный сборкой без текстов, ставится заново", async () => {
    const stale = (await db.packages.get("m01-1"))!;
    await db.packages.put({ ...stale, readings: undefined });
    expect(await moduleReadings("m01", db)).toHaveLength(1);
    expect((await installLesson("m01-1", db, memoryFetcher(demo))).status).not.toBe("current");
    expect(await moduleReadings("m01", db)).toHaveLength(2);
  });

  it("отметка не делает урок начатым, не считается заданием и учебным днём", async () => {
    await markRead("r-m01-anna", true, db);
    expect(await studiedLessons(course, db)).toEqual([]);
    expect(await lessonDays("2026-01-01", "UTC", undefined, db)).toEqual([]);
    expect(describeSnapshot(await readSnapshot(db, now)).blocks).toBe(0);
    expect(await courseLessonIds(course, db)).not.toContain("r-m01-anna");
  });

  it("отметка переходит на устройство, где урок не установлен", async () => {
    await markRead("r-m01-anna", true, db);
    const other = await fresh("tetradio-readings-other");
    try {
      expect(await applySnapshot(other, await readSnapshot(db, now), "v1", { a: 1 }, now)).toBe(true);
      expect((await other.blockProgress.get("r-m01-anna/read"))?.done).toBe(true);
    } finally {
      other.close();
      await other.delete();
    }
  });

  it("копия с отметкой восстанавливается", async () => {
    await markRead("r-m01-anna", true, db);
    const parsed = JSON.parse(await (await exportFull(db)).text());
    const copy = new Blob([JSON.stringify({ ...parsed, data: { ...parsed.data, databaseName: "tetradio" } })], {
      type: "application/json",
    });
    const target = await fresh("tetradio-readings-restored");
    try {
      await restoreBackup(copy, target);
      expect((await target.blockProgress.get("r-m01-anna/read"))?.done).toBe(true);
    } finally {
      target.close();
      await target.delete();
    }
  });
});
