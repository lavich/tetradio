import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { AppDatabase } from "../src/storage/db";
import { lessonDays } from "../src/storage/course";
import { courseLessonIds } from "../src/storage/courses";
import { studiedLessons } from "../src/storage/queries";
import { courseReadings, markRead, moduleReadings, nextUnreadReading, readingPage } from "../src/storage/readings";
import { lessonOutlines } from "../src/storage/outlines";
import type { InstalledPackage } from "../src/domain/types";
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
    expect((await courseReadings(course, db)).unread[0]?.reading.id).toBe("r-m01-anna");
    expect(await courseReadings("other-course", db)).toEqual({ open: [], unread: [], closed: 0, pending: 0 });
  });

  it("отметку «прочитано» можно поставить и снять; «Сегодня» предлагает только непрочитанное", async () => {
    await db.lessons.update("m01-1", { completed: true });
    await markRead("r-m01-anna", true, db);
    const page = (await readingPage("r-m01-anna", db))!;
    expect(page.readAt).toBeDefined();
    expect(page.next?.reading.id).toBe("r-m01-lemesos");
    expect(page.cards.size).toBeGreaterThan(0);
    expect((await courseReadings(course, db)).unread).toEqual([]);
    await markRead("r-m01-anna", false, db);
    expect((await readingPage("r-m01-anna", db))!.readAt).toBeUndefined();
    expect((await courseReadings(course, db)).unread[0]?.reading.id).toBe("r-m01-anna");
  });

  it("тексты курса: открытые, непрочитанные и закрытые считаются по состояниям прохождения", async () => {
    const summary = async () => {
      const { open, unread, closed, closedAfter, pending } = await courseReadings(course, db);
      return {
        open: open.map((view) => view.reading.id),
        unread: unread.map((view) => view.reading.id),
        closed,
        closedAfter: closedAfter?.title,
        pending,
      };
    };
    expect(await summary()).toEqual({
      open: [],
      unread: [],
      closed: 2,
      closedAfter: "Знакомство и είμαι",
      pending: 0,
    });
    await db.lessons.update("m01-1", { completed: true });
    expect(await summary()).toEqual({
      open: ["r-m01-anna"],
      unread: ["r-m01-anna"],
      closed: 1,
      closedAfter: "Контрольная модуля 01",
      pending: 0,
    });
    await db.lessons.update("m01-test", { completed: true });
    expect(await summary()).toEqual({
      open: ["r-m01-anna", "r-m01-lemesos"],
      unread: ["r-m01-anna", "r-m01-lemesos"],
      closed: 0,
      pending: 0,
    });
    await markRead("r-m01-anna", true, db);
    expect((await summary()).unread).toEqual(["r-m01-lemesos"]);
    expect((await courseReadings(course, db)).open[0]).toMatchObject({ module: { number: 1 }, open: true });
  });

  it("курс без текстов: ничего открытого, закрытого и скачиваемого", async () => {
    await db.lessons.update("m01-1", { completed: true });
    expect(await courseReadings("nothing", db)).toEqual({ open: [], unread: [], closed: 0, pending: 0 });
  });

  it("пакет, поставленный сборкой без текстов, ставится заново", async () => {
    const stale = (await db.packages.get("m01-1"))!;
    await db.packages.put({ ...stale, readings: undefined });
    expect(await moduleReadings("m01", db)).toHaveLength(1);
    expect((await installLesson("m01-1", db, memoryFetcher(demo))).status).not.toBe("current");
    expect(await moduleReadings("m01", db)).toHaveLength(2);
  });

  it("пакет, поставленный сборкой без записей текстов, ставится заново", async () => {
    const stale = (await db.packages.get("m01-1"))!;
    await db.packages.put({
      ...stale,
      readings: stale.readings!.map(({ audio: _audio, ...reading }) => reading),
    });
    expect((await installLesson("m01-1", db, memoryFetcher(demo))).status).not.toBe("current");
    expect((await db.packages.get("m01-1"))!.readings![0].audio).toHaveLength(10);
    expect((await installLesson("m01-1", db, memoryFetcher(demo))).status).toBe("current");
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

const template = demo.packages.find((pack) => pack.id === "m01-1")!;
interface SeedLesson {
  id: string;
  title?: string;
  readings?: string[];
  done?: boolean;
  installed?: boolean;
}
interface SeedModule {
  id: string;
  number: number;
  lessons: SeedLesson[];
  checkpoint?: SeedLesson;
}
async function seed(database: AppDatabase, courseId: string, modules: SeedModule[]) {
  for (const [position, module] of modules.entries()) {
    const all = [...module.lessons, ...(module.checkpoint ? [module.checkpoint] : [])];
    await database.modules.put({
      id: module.id,
      courseId,
      number: module.number,
      title: `Модуль ${module.number}`,
      subtitle: "",
      status: "published",
      goal: "",
      grammar: [],
      sessions: 1,
      lessonIds: module.lessons.map((lesson) => lesson.id),
      ...(module.checkpoint ? { checkpointId: module.checkpoint.id } : {}),
      position,
    });
    for (const lesson of all) {
      const readings = lesson.readings ?? [];
      await database.catalog.put({
        id: lesson.id,
        title: lesson.title ?? lesson.id,
        readings: readings.length,
      } as never);
      await database.lessons.put({
        id: lesson.id,
        courseId,
        title: lesson.title ?? lesson.id,
        completed: !!lesson.done,
        updatedAt: now.toISOString(),
      });
      if (lesson.installed === false) continue;
      await database.packages.put({
        ...template,
        lessonId: lesson.id,
        module: { id: module.id, position },
        readings: readings.map((id) => ({ ...template.readings![0], id, title: id })),
      } as unknown as InstalledPackage);
    }
  }
}
const ids = (views: { reading: { id: string } }[]) => views.map((view) => view.reading.id);

describe("порядок и счёт текстов по программе", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    db = await fresh("tetradio-readings-order");
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("порядок программы, а не ключа: m01-2 идёт перед m01-10, контрольная — после уроков, модули — по номеру", async () => {
    await seed(db, "syn", [
      {
        id: "m03",
        number: 3,
        lessons: [{ id: "m03-1", readings: ["c"], done: true }],
      },
      {
        id: "m01",
        number: 1,
        lessons: [
          { id: "m01-10", readings: ["b"], done: true },
          { id: "m01-2", readings: ["a1", "a2"], done: true },
        ],
        checkpoint: { id: "m01-k1", readings: ["k"], done: true },
      },
    ]);
    const expected = ["b", "a1", "a2", "k"];
    expect(ids((await courseReadings("syn", db)).open)).toEqual([...expected, "c"]);
    expect(ids(await moduleReadings("m01", db))).toEqual(expected);
    expect((await readingPage("a1", db))!.next?.reading.id).toBe("a2");
    expect((await readingPage("a2", db))!.next?.reading.id).toBe("k");
  });

  it("группировка по модулям: у каждого текста номер и название модуля", async () => {
    await seed(db, "syn", [
      { id: "m01", number: 1, lessons: [{ id: "m01-1", readings: ["a"], done: true }] },
      { id: "m02", number: 2, lessons: [{ id: "m02-1", readings: ["b"], done: false }] },
    ]);
    const result = await courseReadings("syn", db);
    expect(result.open.map((view) => view.module)).toEqual([{ number: 1, title: "Модуль 1" }]);
    expect(result).toMatchObject({ closed: 1, closedAfter: { id: "m02-1" } });
  });

  it("пройденный, но не скачанный урок: тексты ждут скачивания и не попадают в закрытые", async () => {
    await seed(db, "syn", [
      {
        id: "m01",
        number: 1,
        lessons: [
          { id: "m01-1", readings: ["a"], done: true, installed: false },
          { id: "m01-2", readings: ["b"], done: false },
        ],
      },
    ]);
    expect(await courseReadings("syn", db)).toMatchObject({ pending: 1, open: [], closed: 1 });
    await seed(db, "syn", [
      {
        id: "m01",
        number: 1,
        lessons: [
          { id: "m01-1", readings: ["a"], done: true },
          { id: "m01-2", readings: ["b"], done: false },
        ],
      },
    ]);
    const after = await courseReadings("syn", db);
    expect(after.pending).toBe(0);
    expect(ids(after.open)).toEqual(["a"]);
  });

  it("без скачанных пакетов не падает и пакеты закрытых уроков не читает", async () => {
    expect(await courseReadings("syn", db)).toEqual({ open: [], unread: [], closed: 0, pending: 0 });
    await seed(db, "syn", [
      {
        id: "m01",
        number: 1,
        lessons: [
          { id: "m01-1", readings: ["a"], done: true },
          { id: "m01-2", readings: ["b"], done: false },
        ],
      },
    ]);
    await lessonOutlines(["m01-1"], db);
    const read: string[] = [];
    db.use({
      stack: "dbcore",
      name: "closed-reads",
      create: (down) => ({
        ...down,
        table: (name) => {
          const table = down.table(name);
          if (name !== "packages") return table;
          return {
            ...table,
            getMany: async (req) => {
              read.push(...(req.keys as string[]));
              return table.getMany(req);
            },
            get: async (req) => {
              read.push(req.key as string);
              return table.get(req);
            },
          };
        },
      }),
    });
    await courseReadings("syn", db);
    expect(read).not.toContain("m01-2");
  });

  it("следующий непрочитанный после текста — в том числе в соседнем модуле; прочитанные пропускаются", async () => {
    await seed(db, "syn", [
      { id: "m01", number: 1, lessons: [{ id: "m01-1", readings: ["a", "b"], done: true }] },
      { id: "m02", number: 2, lessons: [{ id: "m02-1", readings: ["c", "d"], done: true }] },
    ]);
    await markRead("c", true, db);
    const after = async (id: string) => (await nextUnreadReading("syn", id, db))?.reading.id;
    expect(await after("a")).toBe("b");
    expect(await after("b")).toBe("d");
    expect(await after("d")).toBeUndefined();
  });
});
