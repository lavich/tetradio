import "fake-indexeddb/auto";
import "./helpers/self";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { installLesson, refreshCatalog } from "../src/content/client";
import { makeSession } from "../src/domain/learning";
import { exportWordsTsv } from "../src/features/backup/backup";
import { sessionPath } from "../src/features/learning/session-actions";
import { coursesOrder, primaryCourse, setPrimaryCourse } from "../src/storage/courses";
import { db } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { memoryFetcher } from "./helpers/content";

/** Греческий демонстрационный курс и маленький английский: английский стоит в каталоге первым. */
const built = buildContent("tests/fixtures/two-courses");
const ENGLISH_WORDS = ["to go", "the bus", "to read", "the coffee", "to write"];

beforeEach(async () => {
  db.close();
  await db.delete();
  await db.open();
});
async function install(...lessonIds: string[]) {
  const fetcher = memoryFetcher(built);
  await refreshCatalog(db, fetcher);
  for (const id of lessonIds) await installLesson(id, db, fetcher);
}

describe("порядок установки курсов", () => {
  it("курс запоминается первым установленным уроком, не дожидаясь следующего каталога", async () => {
    await install("m01-1", "e01-1");
    expect(await coursesOrder(db)).toEqual(["greek-a2", "english"]);
    expect(await primaryCourse(db)).toBe("greek-a2");
  });
  it("английский, поставленный первым, становится основным", async () => {
    await install("e01-1", "m01-1");
    expect(await primaryCourse(db)).toBe("english");
  });
});

describe("адрес занятия", () => {
  it("у основного курса — прежний /session, у второго — с курсом", async () => {
    await install("m01-1", "e01-1");
    expect(await sessionPath("greek-a2")).toBe("/session");
    expect(await sessionPath(undefined)).toBe("/session");
    expect(await sessionPath("english")).toBe("/session?course=english");
    await setPrimaryCourse("english", db);
    expect(await sessionPath("english")).toBe("/session");
    expect(await sessionPath("greek-a2")).toBe("/session?course=greek-a2");
  });
});

describe("язык карточек — язык курса", () => {
  it("английские слова не собираются из слогов, варианты — английские слова", async () => {
    await install("m01-1", "e01-1");
    await db.lessons.update("e01-1", { completed: true });
    const session = await makeSession({
      source: dexieSource(db),
      now: new Date(),
      courseId: "english",
      mode: "practice",
      refs: ENGLISH_WORDS.map((_, index) => ({ kind: "word", id: `e000${index + 1}` })),
      random: () => 0.4,
    });
    expect(session.items).toHaveLength(5);
    expect(session.items.some((item) => item.type === "assembly")).toBe(false);
    for (const item of session.items.filter((entry) => entry.type === "listening"))
      expect(item.options.every((option) => ENGLISH_WORDS.includes(option))).toBe(true);
  });
  it("шапка TSV — по языку курса первого слова", async () => {
    await install("e01-1");
    expect((await (await exportWordsTsv(db)).text()).split("\n")[0]).toBe("Английский\tРусский\tIPA");
  });
});
