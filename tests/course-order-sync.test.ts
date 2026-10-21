import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { installCourse, installPackages, refreshCatalog } from "../src/content/client";
import { AppDatabase } from "../src/storage/db";
import {
  COURSES_ORDER_KEY,
  currentLanguage,
  HOME_COURSE_KEY,
  homeCourse,
  PRIMARY_COURSE_KEY,
  primaryCourse,
  shelfLanguage,
} from "../src/storage/courses";
import { kvAdapter } from "../src/sync/adapter";
import { META, writeMeta } from "../src/sync/snapshot";
import { SyncCoordinator } from "../src/sync/coordinator";
import { memoryTransport, type MemoryTransport } from "../src/sync/transport";
import { memoryFetcher } from "./helpers/content";

const twoCourses = buildContent("tests/fixtures/two-courses");
let cloud: MemoryTransport;
let counter = 0;

async function device(name: string) {
  const db = new AppDatabase(`tetradio-course-order-${name}-${++counter}`);
  await db.delete();
  await db.open();
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(cloud),
    now: () => new Date("2026-10-20T09:00:00Z"),
    label: name,
    schedule: () => () => undefined,
    retryBaseMs: 1,
  });
  return { db, sync };
}
const order = async (db: AppDatabase) => JSON.parse((await db.meta.get(COURSES_ORDER_KEY))?.value ?? "[]");

async function phoneWithBothCourses(greekAt = "2026-10-05T09:00:00.000Z", englishAt = "2026-10-12T09:00:00.000Z") {
  const phone = await device("phone");
  const fetcher = memoryFetcher(twoCourses);
  await refreshCatalog(phone.db, fetcher);
  await installCourse("greek-a2", phone.db, fetcher);
  await installCourse("english", phone.db, fetcher);
  await phone.db.lessons.where("courseId").equals("greek-a2").modify({ updatedAt: greekAt });
  await phone.db.lessons.where("courseId").equals("english").modify({ updatedAt: englishAt });
  await writeMeta(phone.db, META.dirty, "lessons");
  expect((await phone.sync.exchange()).phase).toBe("synced");
  return phone;
}
async function receive(fresh: Awaited<ReturnType<typeof device>>) {
  const fetcher = memoryFetcher(twoCourses);
  await refreshCatalog(fresh.db, fetcher);
  const missing: string[] = [];
  fresh.sync.onMissingPackages = (ids) => void missing.push(...ids);
  expect((await fresh.sync.exchange()).phase).toBe("synced");
  expect(missing[0]).toMatch(/^e01-/);
  await installPackages(missing, fresh.db, fetcher);
}

beforeEach(() => {
  cloud = memoryTransport();
});

describe("порядок курсов на новом устройстве", () => {
  it("курс, начатый раньше, — первый, домашний и основной, хотя его пакеты ставятся позже", async () => {
    await phoneWithBothCourses();
    const fresh = await device("fresh");
    await receive(fresh);
    expect(await order(fresh.db)).toEqual(["greek-a2", "english"]);
    expect(await homeCourse(fresh.db)).toBe("greek-a2");
    expect(await primaryCourse(fresh.db)).toBe("greek-a2");
  });
  it("время начала важнее места курса в каталоге", async () => {
    await phoneWithBothCourses("2026-10-12T09:00:00.000Z", "2026-10-05T09:00:00.000Z");
    const fresh = await device("fresh");
    await receive(fresh);
    expect(await order(fresh.db)).toEqual(["english", "greek-a2"]);
    expect(await homeCourse(fresh.db)).toBe("english");
  });
  it("записанные порядок и домашний курс не перезаписываются", async () => {
    await phoneWithBothCourses();
    const tablet = await device("tablet");
    await tablet.db.meta.bulkPut([
      { key: COURSES_ORDER_KEY, value: JSON.stringify(["english", "greek-a2"]) },
      { key: HOME_COURSE_KEY, value: "english" },
    ]);
    await receive(tablet);
    expect(await order(tablet.db)).toEqual(["english", "greek-a2"]);
    expect((await tablet.db.meta.get(HOME_COURSE_KEY))?.value).toBe("english");
  });
});

describe("новое устройство, пока стоят только английские пакеты", () => {
  it("основной — греческий, начатый первым; язык экранов и полки — греческий", async () => {
    await phoneWithBothCourses();
    const fresh = await device("partial");
    const fetcher = memoryFetcher(twoCourses);
    await refreshCatalog(fresh.db, fetcher);
    expect((await fresh.sync.exchange()).phase).toBe("synced");
    await installPackages(["e01-1"], fresh.db, fetcher);
    expect(await primaryCourse(fresh.db)).toBe("greek-a2");
    expect(await currentLanguage(fresh.db)).toBe("el");
    expect(await shelfLanguage(fresh.db)).toBe("el");
  });
});

describe("сбой до первого урока", () => {
  it("не записывает порядок, домашний и основной курс", async () => {
    const fresh = await device("offline");
    await refreshCatalog(fresh.db, memoryFetcher(twoCourses));
    const packages = twoCourses.catalog.lessons.filter((lesson) => lesson.courseId === "greek-a2");
    const broken = Object.fromEntries(packages.map((lesson) => [lesson.url, { broken: true }]));
    await installCourse("greek-a2", fresh.db, memoryFetcher(twoCourses, broken));
    expect(await fresh.db.lessons.count()).toBe(0);
    for (const key of [COURSES_ORDER_KEY, HOME_COURSE_KEY, PRIMARY_COURSE_KEY])
      expect(await fresh.db.meta.get(key)).toBeUndefined();
  });
});
