import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Course } from "../src/domain/types";
import { AppDatabase, type StoredCatalogEntry } from "../src/storage/db";
import {
  currentLanguage,
  followCourse,
  languages,
  rememberCourses,
  setCurrentLanguage,
  setPrimaryCourse,
  shelfLanguage,
} from "../src/storage/courses";
import { PENDING_LESSONS_KEY } from "../src/storage/pending";
import { readSnapshot } from "../src/sync/snapshot";

const GREEK = "greek-a2";
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
  { id: GREEK, title: "Греческий", short: "Греческий", level: "A0 → A2", order: 1, updatedAt: iso },
  {
    id: IT,
    title: "Английский для IT",
    short: "Для IT",
    level: "B1 → B2",
    palette: "ink",
    language: "en",
    order: 2,
    updatedAt: iso,
  },
  {
    id: TRAVEL,
    title: "Английский для путешествий и общения",
    short: "Для путешествий",
    palette: "coast",
    language: "en",
    order: 3,
    updatedAt: iso,
  },
];

let db: AppDatabase;
const start = async (courseId: string, at = iso) => {
  await db.lessons.add({ id: `${courseId}-1`, courseId, title: courseId, completed: false, updatedAt: at });
  await rememberCourses(db);
};
const forget = (courseId: string) => db.lessons.where("courseId").equals(courseId).delete();
const waiting = (lessonId: string) =>
  db.meta.put({
    key: PENDING_LESSONS_KEY,
    value: JSON.stringify({ [lessonId]: { id: lessonId, completed: true, updatedAt: iso } }),
  });

beforeEach(async () => {
  await new AppDatabase("tetradio-language-courses").delete();
  db = new AppDatabase("tetradio-language-courses");
  await db.courses.bulkAdd(rows);
  await db.catalog.bulkAdd([
    entry(`${GREEK}-1`, GREEK, "el", 0),
    entry(`${IT}-1`, IT, "en", 1),
    entry(`${TRAVEL}-1`, TRAVEL, "en", 2),
  ]);
});
afterEach(() => db.close());

describe("языки из курсов", () => {
  it("греческий и английский с двумя курсами, по первому курсу языка; начатый язык — по начатым курсам", async () => {
    await start(TRAVEL);
    const list = await languages(db);
    expect(list.map((language) => language.code)).toEqual(["en", "el"]);
    expect(list.map((language) => language.title)).toEqual(["Английский", "Греческий"]);
    expect(list[0].courses.map((course) => course.id)).toEqual([TRAVEL, IT]);
    expect(list.map((language) => language.started)).toEqual([true, false]);
    expect(list[0].courses[1]).toMatchObject({ level: "B1 → B2", palette: "ink", short: "Для IT" });
    expect(list[1].courses[0].palette).toBe("school");
  });
  it("язык, курсы которого только из черновых модулей, не предлагается", async () => {
    await db.catalog.where("courseId").anyOf(IT, TRAVEL).delete();
    expect((await languages(db)).map((language) => language.code)).toEqual(["el"]);
  });
  it("курс, ждущий установки из снимка, делает язык начатым, но не установленным", async () => {
    await start(GREEK);
    await waiting(`${IT}-1`);
    const english = (await languages(db)).find((language) => language.code === "en")!;
    expect(english.started).toBe(true);
    expect(english.installed).toBe(false);
  });
});

describe("выбор языка", () => {
  beforeEach(() => start(GREEK));

  it("без выбора — язык основного курса", async () => {
    await start(IT);
    expect(await currentLanguage(db)).toBe("el");
    await setPrimaryCourse(IT, db);
    expect(await currentLanguage(db)).toBe("en");
    expect(await shelfLanguage(db)).toBe("en");
  });
  it("выбранный язык с начатым курсом — на всех экранах и после перезапуска", async () => {
    await start(TRAVEL);
    await setCurrentLanguage("en", db);
    db.close();
    db = new AppDatabase("tetradio-language-courses");
    expect(await currentLanguage(db)).toBe("en");
    expect(await shelfLanguage(db)).toBe("en");
  });
  it("«+ Английский» виден только «Курсу»; «Слова» показывают прежний начатый язык", async () => {
    await setCurrentLanguage("en", db);
    expect(await shelfLanguage(db)).toBe("en");
    expect(await currentLanguage(db)).toBe("el");
  });
  it("«+»-выбор не стирает начатый выбор", async () => {
    await start(IT);
    await setCurrentLanguage("en", db);
    await forget(GREEK);
    await waiting(`${GREEK}-1`);
    await setCurrentLanguage("el", db);
    expect(await shelfLanguage(db)).toBe("el");
    expect(await currentLanguage(db)).toBe("en");
  });
  it("прежний «+»-язык, курс которого с тех пор начат, поднимается в начатый выбор", async () => {
    await setCurrentLanguage("en", db);
    await start(IT);
    await forget(GREEK);
    await waiting(`${GREEK}-1`);
    await setCurrentLanguage("el", db);
    await setPrimaryCourse(GREEK, db);
    expect(await currentLanguage(db)).toBe("en");
  });
  it("язык курса, только ждущего установки, «Курс» показывает, а «Слова» — нет", async () => {
    await waiting(`${IT}-1`);
    await setCurrentLanguage("en", db);
    expect(await shelfLanguage(db)).toBe("en");
    expect(await currentLanguage(db)).toBe("el");
  });
});

describe("выбор прежней версии", () => {
  beforeEach(() => start(GREEK));

  it("начатый выбор курса становится выбором его языка", async () => {
    await start(IT);
    await db.meta.put({ key: "currentCourse", value: IT });
    expect(await currentLanguage(db)).toBe("en");
    expect(await shelfLanguage(db)).toBe("en");
  });
  it("неначатый выбор без начатого выбора выбор языка не создаёт", async () => {
    await db.meta.put({ key: "currentCourse", value: IT });
    expect(await shelfLanguage(db)).toBe("el");
    expect(await currentLanguage(db)).toBe("el");
  });
  it("неначатый выбор при начатом выборе прежней версии — выбор языка неначатого курса", async () => {
    await start(TRAVEL);
    await db.meta.bulkPut([
      { key: "currentCourse", value: IT },
      { key: "currentStartedCourse", value: TRAVEL },
    ]);
    expect(await shelfLanguage(db)).toBe("en");
    expect(await currentLanguage(db)).toBe("en");
  });
  it("прежние ключи выбора курса остаются: откат видит свой выбор", async () => {
    await start(IT);
    await db.meta.put({ key: "currentCourse", value: IT });
    await setCurrentLanguage("el", db);
    expect((await db.meta.get("currentCourse"))?.value).toBe(IT);
  });
});

describe("выбор прежней версии без начатого греческого", () => {
  it("первый «+»-выбор новой версии сохраняет начатый выбор прежней", async () => {
    await start(IT);
    await db.meta.put({ key: "currentCourse", value: IT });
    await setCurrentLanguage("el", db);
    expect(await shelfLanguage(db)).toBe("el");
    expect(await currentLanguage(db)).toBe("en");
  });
});

describe("ссылка на курс", () => {
  beforeEach(() => start(GREEK));

  it("ссылка на курс другого языка выбирает его язык", async () => {
    await start(IT);
    await followCourse(IT, db);
    expect(await currentLanguage(db)).toBe("en");
  });
  it("ссылка на курс, которого нет ни в каталоге, ни на устройстве, выбор не пишет", async () => {
    await start(IT);
    await setCurrentLanguage("en", db);
    await followCourse("removed-course", db);
    expect(await currentLanguage(db)).toBe("en");
    expect((await db.meta.get("currentLanguage"))?.value).toBe("en");
  });
  it("ссылка на курс показанного языка выбор не пишет", async () => {
    await start(IT);
    await followCourse(GREEK, db);
    expect(await db.meta.get("currentLanguage")).toBeUndefined();
  });
  it("при «+ Английский» на «Курсе» ссылка на греческий курс возвращает греческий", async () => {
    await setCurrentLanguage("en", db);
    await followCourse(GREEK, db);
    expect(await shelfLanguage(db)).toBe("el");
  });
});

describe("снимок облака", () => {
  it("ключи выбора языка в снимок не попадают", async () => {
    await start(GREEK);
    await start(IT);
    await setCurrentLanguage("en", db);
    const snapshot = JSON.stringify(await readSnapshot(db, new Date(iso)));
    expect(snapshot).not.toContain("currentLanguage");
    expect(snapshot).not.toContain("currentStartedLanguage");
  });
});
