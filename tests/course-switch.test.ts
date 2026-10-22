import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Course } from "../src/domain/types";
import { AppDatabase, type StoredCatalogEntry } from "../src/storage/db";
import {
  chooseShelfCourse,
  currentLanguage,
  followCourse,
  primaryCourse,
  rememberCourses,
  setCurrentLanguage,
  setPrimaryCourse,
  shelfCourse,
  shelfLanguage,
} from "../src/storage/courses";
import { PENDING_LESSONS_KEY } from "../src/storage/pending";
import { readSnapshot } from "../src/sync/snapshot";

const A2 = "greek-a2";
const B1 = "greek-b1";
const IT = "english-it";
const TRAVEL = "english-travel";
const iso = "2026-10-08T09:00:00.000Z";

const entry = (id: string, courseId: string, language: string, position: number): StoredCatalogEntry => ({
  id,
  courseId,
  language,
  title: id,
  wordCount: 0,
  phraseCount: 0,
  cardCount: 0,
  version: "1",
  url: "",
  bytes: 0,
  media: { count: 0, bytes: 0 },
  position,
});
const rows: Course[] = [
  { id: A2, title: "Греческий A2", short: "A2", order: 1, updatedAt: iso },
  { id: B1, title: "Греческий B1", short: "B1", order: 2, updatedAt: iso },
  { id: IT, title: "Английский для IT", short: "Для IT", language: "en", order: 3, updatedAt: iso },
  {
    id: TRAVEL,
    title: "Английский для путешествий",
    short: "Для путешествий",
    language: "en",
    order: 4,
    updatedAt: iso,
  },
];

let db: AppDatabase;
const start = async (courseId: string) => {
  await db.lessons.add({ id: `${courseId}-1`, courseId, title: courseId, completed: false, updatedAt: iso });
  await rememberCourses(db);
};

beforeEach(async () => {
  await new AppDatabase("tetradio-course-switch").delete();
  db = new AppDatabase("tetradio-course-switch");
  await db.courses.bulkAdd(rows);
  await db.catalog.bulkAdd([
    entry(`${A2}-1`, A2, "el", 0),
    entry(`${B1}-1`, B1, "el", 1),
    entry(`${IT}-1`, IT, "en", 2),
    entry(`${TRAVEL}-1`, TRAVEL, "en", 3),
  ]);
});
afterEach(() => db.close());

describe("курс на «Курсе»", () => {
  it("по умолчанию — основной курс языка, затем первый начатый, затем первый курс", async () => {
    expect(await shelfCourse(db)).toBe(A2);
    await start(A2);
    await start(IT);
    await start(TRAVEL);
    await setCurrentLanguage("en", db);
    expect(await shelfCourse(db)).toBe(IT);
    await setPrimaryCourse(TRAVEL, db);
    expect(await shelfCourse(db)).toBe(TRAVEL);
  });
  it("курс, ждущий установки из снимка, по умолчанию уступает установленному", async () => {
    await start(IT);
    await db.meta.put({
      key: PENDING_LESSONS_KEY,
      value: JSON.stringify({ [`${TRAVEL}-1`]: { id: `${TRAVEL}-1`, completed: true, updatedAt: iso } }),
    });
    await setPrimaryCourse(TRAVEL, db);
    await setCurrentLanguage("en", db);
    expect(await shelfCourse(db)).toBe(IT);
  });
  it("без начатых курсов языка — первый курс языка", async () => {
    await start(A2);
    await setCurrentLanguage("en", db);
    expect(await shelfCourse(db)).toBe(IT);
  });
  it("выбор запоминается и действует, пока курс в языке «Курса»", async () => {
    await start(A2);
    await start(IT);
    await start(TRAVEL);
    await chooseShelfCourse(TRAVEL, db);
    expect(await shelfLanguage(db)).toBe("en");
    expect(await shelfCourse(db)).toBe(TRAVEL);
    await setCurrentLanguage("el", db);
    expect(await shelfCourse(db)).toBe(A2);
    await setCurrentLanguage("en", db);
    expect(await shelfCourse(db)).toBe(TRAVEL);
  });
  it("не меняет основной курс; язык другого начатого курса выбирается, как в переключателе языка", async () => {
    await start(A2);
    await start(IT);
    await start(TRAVEL);
    await chooseShelfCourse(TRAVEL, db);
    expect(await primaryCourse(db)).toBe(A2);
    expect(await currentLanguage(db)).toBe("en");
  });
  it("выбор неначатого курса: язык «Курса» без начатых курсов меняется, запомненный язык «Слов» нет", async () => {
    await start(A2);
    await chooseShelfCourse(IT, db);
    expect(await shelfLanguage(db)).toBe("en");
    expect(await shelfCourse(db)).toBe(IT);
    expect(await currentLanguage(db)).toBe("el");
  });
  it("неизвестный курс выбор не меняет", async () => {
    await start(A2);
    await start(B1);
    await chooseShelfCourse(B1, db);
    await chooseShelfCourse("no-such", db);
    expect(await shelfCourse(db)).toBe(B1);
  });
  it("греческий A2 и B1 — тот же выбор, что у английского", async () => {
    await start(A2);
    expect(await shelfCourse(db)).toBe(A2);
    await chooseShelfCourse(B1, db);
    expect(await shelfCourse(db)).toBe(B1);
    expect(await shelfLanguage(db)).toBe("el");
    await start(B1);
    expect(await shelfCourse(db)).toBe(B1);
  });
  it("у каждого языка свой выбор: выбор английского не стирает выбор греческого", async () => {
    await start(A2);
    await start(B1);
    await start(IT);
    await start(TRAVEL);
    await chooseShelfCourse(B1, db);
    await chooseShelfCourse(TRAVEL, db);
    await setCurrentLanguage("el", db);
    expect(await shelfCourse(db)).toBe(B1);
    await setCurrentLanguage("en", db);
    expect(await shelfCourse(db)).toBe(TRAVEL);
  });
  it("открытие модуля или урока начатого курса выбирает его на «Курсе»; неначатый курс выбор не меняет", async () => {
    await start(IT);
    await start(TRAVEL);
    await followCourse(TRAVEL, db);
    expect(await shelfCourse(db)).toBe(TRAVEL);
    await start(A2);
    await followCourse(IT, db);
    await followCourse(B1, db);
    expect(JSON.parse((await db.meta.get("shelfCourse"))!.value)).toEqual({ en: IT });
  });
  it("курс, ушедший из каталога, не показывается", async () => {
    await start(IT);
    await start(TRAVEL);
    await chooseShelfCourse(TRAVEL, db);
    await db.lessons.where("courseId").equals(TRAVEL).delete();
    await db.catalog.where("courseId").equals(TRAVEL).delete();
    expect(await shelfCourse(db)).toBe(IT);
  });
  it("ключ выбора в снимок облака не попадает", async () => {
    await start(IT);
    await start(TRAVEL);
    await chooseShelfCourse(TRAVEL, db);
    expect(JSON.parse((await db.meta.get("shelfCourse"))!.value)).toEqual({ en: TRAVEL });
    expect(JSON.stringify(await readSnapshot(db, new Date(iso)))).not.toContain("shelfCourse");
  });
});
