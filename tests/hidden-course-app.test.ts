import "fake-indexeddb/auto";
import "./helpers/self";
import { createEmptyCard } from "ts-fsrs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { installLesson, installPackages, refreshCatalog, syncCourses } from "../src/content/client";
import { makeSession } from "../src/domain/learning";
import { unitKey, wordRef } from "../src/domain/refs";
import { readSnapshot } from "../src/sync/snapshot";
import { PENDING_LESSONS_KEY } from "../src/storage/pending";
import {
  anyActiveSession,
  courses,
  currentLanguage,
  homeCourse,
  languages,
  languageSession,
  primaryCourse,
  setCurrentLanguage,
  setPrimaryCourse,
  shelfCourse,
  shelfLanguage,
} from "../src/storage/courses";
import { db } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { languagePlan } from "../src/storage/today";
import { memoryFetcher } from "./helpers/content";
import { hiddenFixture } from "./helpers/hidden-fixture";

const ENGLISH = ["english", "talk", "travel"];
const full = memoryFetcher(buildContent("tests/fixtures/two-courses"));
const hiddenBuilt = buildContent(hiddenFixture(ENGLISH));
const hiddenFetcher = () => memoryFetcher(hiddenBuilt);
const NOW = new Date("2026-10-25T09:00:00Z");
const DUE = new Date("2026-10-20T09:00:00Z");

beforeEach(async () => {
  db.close();
  await db.delete();
  await db.open();
});

async function studyEnglish() {
  await refreshCatalog(db, full);
  for (const id of ["m01-1", "e01-1", "c01-1"]) {
    await installLesson(id, db, full);
    await db.lessons.update(id, { completed: true });
  }
  for (const ref of [wordRef("e0001"), wordRef("geia")]) {
    await db.cardStates.put({
      unitKey: unitKey(ref),
      ref,
      introducedAt: "2026-10-01T09:00:00Z",
      version: 1,
      card: { ...createEmptyCard(new Date("2026-10-01")), due: DUE, state: 2, scheduled_days: 3, reps: 2 },
    });
  }
  await setPrimaryCourse("english", db);
  await db.meta.put({ key: "homeCourse", value: "english" });
  await setCurrentLanguage("en", db);
  const session = await makeSession({
    source: dexieSource(db),
    now: NOW,
    courseId: "english",
    mode: "practice",
    refs: [wordRef("e0001")],
    random: () => 0.4,
  });
  await db.sessions.add(session);
  return session;
}
const meta = async () => (await db.meta.toArray()).map((row) => [row.key, row.value]);

describe("каталог без английских курсов, прогресс английского в базе", () => {
  beforeEach(async () => {
    await studyEnglish();
  });

  it("курсы и языки — только греческий", async () => {
    expect((await courses(db)).map((course) => course.id)).toContain("english");
    await refreshCatalog(db, hiddenFetcher());
    expect((await courses(db)).map((course) => course.id)).toEqual(["greek-a2"]);
    expect((await languages(db)).map((language) => language.code)).toEqual(["el"]);
  });

  it("основной курс, язык и полка — греческие, домашний курс прежний, и ничего не записано", async () => {
    await refreshCatalog(db, hiddenFetcher());
    const before = await meta();
    expect(await primaryCourse(db)).toBe("greek-a2");
    expect(await currentLanguage(db)).toBe("el");
    expect(await shelfLanguage(db)).toBe("el");
    expect(await shelfCourse(db)).toBe("greek-a2");
    expect(await homeCourse(db)).toBe("english");
    expect(await meta()).toEqual(before);
  });

  it("повторение и план без карточек английского", async () => {
    await refreshCatalog(db, hiddenFetcher());
    const plan = await languagePlan(NOW, "el", db);
    const keys = plan.reviews.map((review) => unitKey(review.ref));
    expect(keys).toContain(unitKey(wordRef("geia")));
    expect(keys).not.toContain(unitKey(wordRef("e0001")));
    expect((await languagePlan(NOW, "en", db)).reviews).toEqual([]);
  });

  it("занятие английского не предлагается и остаётся в базе", async () => {
    expect(await anyActiveSession(db)).not.toBeNull();
    await refreshCatalog(db, hiddenFetcher());
    expect(await anyActiveSession(db)).toBeNull();
    expect(await languageSession("en", db)).toBeNull();
    expect(await db.sessions.count()).toBe(1);
  });

  it("карточка без связей с уроками у скрытого домашнего курса не попадает в греческий план", async () => {
    const ref = wordRef("orphan");
    await db.cardStates.put({
      unitKey: unitKey(ref),
      ref,
      introducedAt: "2026-10-01T09:00:00Z",
      version: 1,
      card: { ...createEmptyCard(new Date("2026-10-01")), due: DUE, state: 2, scheduled_days: 3, reps: 2 },
    });
    await refreshCatalog(db, hiddenFetcher());
    const plan = await languagePlan(NOW, "el", db);
    expect(plan.reviews.map((review) => unitKey(review.ref))).not.toContain(unitKey(ref));
  });

  it("занятие без языка и курса, чей домашний курс скрыт, не предлагается", async () => {
    const [session] = await db.sessions.toArray();
    await db.sessions.put({ ...session, id: "legacy", courseId: undefined, language: undefined });
    await db.sessions.delete(session.id);
    await refreshCatalog(db, hiddenFetcher());
    expect(await anyActiveSession(db)).toBeNull();
    expect(await languageSession("el", db)).toBeNull();
  });

  it("порядок и домашний курс на устройстве без них записываются и со скрытыми курсами", async () => {
    await db.meta.bulkDelete(["homeCourse", "coursesOrder"]);
    await refreshCatalog(db, hiddenFetcher());
    expect(await db.meta.get("homeCourse")).toMatchObject({ value: "greek-a2" });
    expect(JSON.parse((await db.meta.get("coursesOrder"))!.value)).toEqual(["greek-a2", "english", "talk"]);
  });

  it("данные не удаляются", async () => {
    const counts = async () => [
      await db.lessons.where("courseId").anyOf(ENGLISH).count(),
      await db.packages.where("lessonId").anyOf(["e01-1", "c01-1"]).count(),
      await db.words.where("id").anyOf(["e0001", "c0001"]).count(),
      await db.cardStates.count(),
    ];
    const before = await counts();
    await refreshCatalog(db, hiddenFetcher());
    await syncCourses(db, hiddenFetcher());
    expect(await counts()).toEqual(before);
  });

  it("снимок облака по-прежнему несёт английский прогресс", async () => {
    const snapshot = () => readSnapshot(db, NOW);
    const before = await snapshot();
    await refreshCatalog(db, hiddenFetcher());
    const after = await snapshot();
    expect(after.lessons.map((lesson) => lesson.id)).toEqual(before.lessons.map((lesson) => lesson.id));
    expect(after.lessons.map((lesson) => lesson.id)).toContain("e01-1");
    expect(after.states.length).toBe(before.states.length);
  });

  it("снятие hidden возвращает курс, выбор и прогресс", async () => {
    await refreshCatalog(db, hiddenFetcher());
    await refreshCatalog(db, full);
    expect((await courses(db)).map((course) => course.id)).toContain("english");
    expect(await primaryCourse(db)).toBe("english");
    expect(await currentLanguage(db)).toBe("en");
    const plan = await languagePlan(NOW, "en", db);
    expect(plan.reviews.map((review) => unitKey(review.ref))).toContain(unitKey(wordRef("e0001")));
    expect(await anyActiveSession(db)).not.toBeNull();
  });
});

describe("облачные уроки скрытого курса", () => {
  it("пакеты уроков вне каталога не запрашиваются и не дают ошибки", async () => {
    const fetcher = hiddenFetcher();
    await refreshCatalog(db, fetcher);
    await db.meta.put({
      key: PENDING_LESSONS_KEY,
      value: JSON.stringify({ "e01-1": { id: "e01-1", completed: true, updatedAt: NOW.toISOString() } }),
    });
    fetcher.requests.length = 0;
    const result = await installPackages(["e01-1", "m01-1"], db, fetcher);
    expect(result.failed).toBe(0);
    expect(fetcher.requests.some((url) => url.includes("e01-1"))).toBe(false);
    expect(await db.packages.get("m01-1")).toBeDefined();
    expect((await courses(db)).map((course) => course.id)).toEqual(["greek-a2"]);
  });
});

describe("каталог ещё не загружался", () => {
  it("установленный курс остаётся курсом", async () => {
    await studyEnglish();
    await db.catalog.clear();
    expect((await courses(db)).map((course) => course.id)).toContain("english");
  });
});
