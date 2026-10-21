import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePlan } from "../src/domain/learning";
import { AppDatabase } from "../src/storage/db";
import { homeCourse, languageSession, sessionLanguage, setPrimaryCourse, todayCourse } from "../src/storage/courses";
import { languagePlan, todayCourses, todayLanguage } from "../src/storage/today";
import { pauseCourse } from "../src/storage/pause-actions";
import { dexieSource } from "../src/storage/queries";
import { lessonDays, reviewedOn } from "../src/storage/course";
import { PENDING_LESSONS_KEY } from "../src/storage/pending";
import { startSession } from "../src/features/learning/session-actions";
import { activeOf, install, NOW, seedCatalog, wordId } from "./helpers/language-db";

let db: AppDatabase;
beforeEach(async () => {
  await new AppDatabase("tetradio-today-language").delete();
  db = new AppDatabase("tetradio-today-language");
  await db.open();
});
afterEach(() => db.close());

const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const ids = (list: { id: string }[]) => list.map((course) => course.id);
const planIds = (plan: { newRefs: { id: string }[]; reviews: { ref: { id: string } }[] }) => [
  ...plan.newRefs.map((ref) => ref.id),
  ...plan.reviews.map((review) => review.ref.id),
];
async function start(...courses: string[]) {
  await seedCatalog(db);
  for (const [index, id] of courses.entries()) await install(db, id, { due: 2, at: later(index) });
}

describe("язык «Сегодня»", () => {
  it("язык основного курса", async () => {
    await start("greek", "it", "travel");
    expect(await todayLanguage(db)).toBe("el");
    await setPrimaryCourse("travel", db);
    expect(await todayLanguage(db)).toBe("en");
  });
  it("основной на паузе при живом втором курсе языка — тот же язык", async () => {
    await start("it", "greek", "travel");
    await pauseCourse("it", NOW, db);
    expect(await todayLanguage(db)).toBe("en");
    expect(ids(await todayCourses("en", db))).toEqual(["travel"]);
  });
  it("на паузе все курсы основного языка — язык следующего по кругу", async () => {
    await start("it", "travel", "greek");
    await pauseCourse("it", NOW, db);
    await pauseCourse("travel", NOW, db);
    expect(await todayLanguage(db)).toBe("el");
  });
  it("все на паузе — undefined", async () => {
    await start("it", "greek");
    await pauseCourse("it", NOW, db);
    await pauseCourse("greek", NOW, db);
    expect(await todayLanguage(db)).toBeUndefined();
  });
  it("начатых курсов нет — язык первого курса каталога; каталог пуст — null и план без курса", async () => {
    await seedCatalog(db, ["it", "greek"]);
    expect(await todayLanguage(db)).toBe("el");
    await db.delete();
    db = new AppDatabase("tetradio-today-language");
    await db.open();
    expect(await todayLanguage(db)).toBeNull();
    await db.lessons.add({ id: "old", title: "old", completed: true, updatedAt: NOW.toISOString() });
    expect(await languagePlan(NOW, null, db)).toEqual(await makePlan(dexieSource(db), NOW));
  });
  it("курсы языка: основной первым, затем по порядку курсов, без курсов на паузе; в другом языке — по порядку", async () => {
    await start("greek", "travel", "it", "talk");
    await setPrimaryCourse("it", db);
    expect(ids(await todayCourses("en", db))).toEqual(["it", "travel", "talk"]);
    await pauseCourse("travel", NOW, db);
    expect(ids(await todayCourses("en", db))).toEqual(["it", "talk"]);
    expect(ids(await todayCourses("el", db))).toEqual(["greek"]);
    await setPrimaryCourse("greek", db);
    expect(ids(await todayCourses("en", db))).toEqual(["it", "talk"]);
  });
  it("порядок it, greek (основной, на паузе), talk — английский, первым talk, как у todayCourse", async () => {
    await start("it", "greek", "talk");
    await setPrimaryCourse("greek", db);
    await pauseCourse("greek", NOW, db);
    expect(await todayLanguage(db)).toBe("en");
    expect(ids(await todayCourses("en", db))).toEqual(["talk", "it"]);
    expect(await todayCourse(db)).toBe("talk");
  });
  it("основной курс, ждущий установки из снимка, — первый; курс без уроков на устройстве отмечен", async () => {
    await start("greek", "travel");
    await db.meta.put({
      key: PENDING_LESSONS_KEY,
      value: JSON.stringify({ "it-1": { id: "it-1", completed: true, updatedAt: later(-100) } }),
    });
    await setPrimaryCourse("it", db);
    const list = await todayCourses("en", db);
    expect(ids(list)).toEqual(["it", "travel"]);
    expect(list.map((course) => course.installed)).toEqual([false, true]);
  });
  it("план языка — карточки обоих английских курсов, без греческих и без курса на паузе", async () => {
    await start("greek", "it", "travel", "talk");
    await pauseCourse("talk", NOW, db);
    const found = planIds(await languagePlan(NOW, "en", db));
    expect(found.some((id) => id.startsWith("it-"))).toBe(true);
    expect(found.some((id) => id.startsWith("travel-"))).toBe(true);
    expect(found.some((id) => id.startsWith("greek-") || id.startsWith("talk-"))).toBe(false);
  });
});

describe("незаконченное занятие языка", () => {
  beforeEach(() => start("greek", "it", "travel"));
  it("последнее активное занятие языка: новое, прежнее занятие курса, тренировка курса", async () => {
    await db.sessions.add(activeOf("old-it", "it"));
    expect((await languageSession("en", db))?.id).toBe("old-it");
    await db.sessions.add(activeOf("new", "it", { language: "en", createdAt: later(10) }));
    expect((await languageSession("en", db))?.id).toBe("new");
    const practice = activeOf("practice", "travel", { createdAt: later(20) });
    practice.items = practice.items.map((item) => ({ ...item, mode: "practice" }));
    await db.sessions.add(practice);
    expect((await languageSession("en", db))?.id).toBe("practice");
    expect(await languageSession("el", db)).toBeNull();
  });
  it("занятие без курса — язык домашнего курса", async () => {
    await setPrimaryCourse("it", db);
    const old = activeOf("old", undefined);
    await db.sessions.add(old);
    expect(await homeCourse(db)).toBe("greek");
    expect(await sessionLanguage(old, db)).toBe("el");
    expect((await languageSession("el", db))?.id).toBe("old");
    expect(await languageSession("en", db)).toBeNull();
  });
  it("курс на паузе: прежнее занятие повторения ждёт, тренировка и выбранные карточки новой версии — нет", async () => {
    await pauseCourse("travel", NOW, db);
    await db.sessions.add(activeOf("old-travel", "travel"));
    expect(await languageSession("en", db)).toBeNull();
    const practice = activeOf("practice", "travel", { createdAt: later(10) });
    practice.items = practice.items.map((item) => ({ ...item, mode: "practice" }));
    await db.sessions.add(practice);
    expect((await languageSession("en", db))?.id).toBe("practice");
    await db.sessions.add(activeOf("mistakes", "travel", { language: "en", createdAt: later(20) }));
    expect((await languageSession("en", db))?.id).toBe("mistakes");
  });
  it("занятие языка с карточками курса, поставленного на паузу после начала, — продолжается", async () => {
    const session = (await startSession(NOW, { courseIds: ["it", "travel"] }, db))!;
    expect(session.items.some((item) => item.ref.id.startsWith("travel-"))).toBe(true);
    await pauseCourse("travel", NOW, db);
    expect((await languageSession("en", db))?.id).toBe(session.id);
  });
  it("startSession с курсами языка пишет язык и первый курс", async () => {
    const session = (await startSession(NOW, { courseIds: ["travel", "it"] }, db))!;
    expect(session).toMatchObject({ language: "en", courseId: "travel" });
    expect(await sessionLanguage(session, db)).toBe("en");
    expect((await db.sessions.get(session.id))?.language).toBe("en");
  });
});

describe("неделя и счёт — по списку курсов", () => {
  beforeEach(async () => {
    await start("greek", "it", "travel");
    const event = (id: string, word: string) => ({
      id,
      sessionId: "s",
      itemId: id,
      ref: { kind: "word" as const, id: word },
      unitKey: JSON.stringify(["word", word]),
      snapshot: { greek: "", russian: "" },
      type: "recognition" as const,
      mode: "scheduled" as const,
      rating: 3 as const,
      correct: true,
      answer: "",
      createdAt: NOW.toISOString(),
      localDate: "2026-10-08",
      responseTimeMs: 900,
    });
    await db.events.bulkAdd([
      event("e1", wordId("it", 0)),
      event("e2", wordId("travel", 0)),
      event("e3", wordId("travel", 1)),
      event("e4", wordId("greek", 0)),
    ]);
    await db.blockProgress.bulkAdd([
      { key: "it-1/b", lessonId: "it-1", blockId: "b", done: true, updatedAt: "2026-10-06T09:00:00Z" },
      { key: "travel-1/b", lessonId: "travel-1", blockId: "b", done: true, updatedAt: "2026-10-07T09:00:00Z" },
      { key: "greek-1/b", lessonId: "greek-1", blockId: "b", done: true, updatedAt: "2026-10-08T09:00:00Z" },
    ]);
  });
  it("по обоим курсам языка; со строкой курса — как прежде", async () => {
    expect(await reviewedOn("2026-10-08", ["it", "travel"], db)).toBe(3);
    expect(await reviewedOn("2026-10-08", "travel", db)).toBe(2);
    expect(await lessonDays("2026-10-05", "Asia/Nicosia", ["it", "travel"], db)).toEqual(["2026-10-06", "2026-10-07"]);
    expect(await lessonDays("2026-10-05", "Asia/Nicosia", "it", db)).toEqual(["2026-10-06"]);
  });
});
