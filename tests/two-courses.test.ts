import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import { makePlan, makeSession } from "../src/domain/learning";
import { unitKey, wordKeyOf, wordRef } from "../src/domain/refs";
import type { Course, Lesson, LessonItem, Phrase, ReviewEvent, Session, StoredModule, Word } from "../src/domain/types";
import { AppDatabase, indexWord, type StoredCatalogEntry } from "../src/storage/db";
import {
  activeSession,
  cardLanguages,
  courseOfCards,
  courses,
  coursesOrder,
  currentCourse,
  primaryCourse,
  rememberCourses,
  setCurrentCourse,
  setPrimaryCourse,
} from "../src/storage/courses";
import { dexieSource, optionPool, studiedLessons } from "../src/storage/queries";
import { courseProgress } from "../src/storage/progress";
import { dictionary } from "../src/storage/dictionary";
import { moduleViews, reviewedOn } from "../src/storage/course";
import { recordAnswer } from "../src/storage/ops";
import { GREEK_CALENDAR } from "./helpers/calendar";
import { fromSnapshot, type Snapshot } from "./helpers/snapshot-source";

const GREEK = "greek-a2";
const ENGLISH = "english";
const now = new Date("2026-10-08T09:00:00Z");
const iso = now.toISOString();
const ENGLISH_CALENDAR = { start: "2026-11-02", checkpoints: [] };

const word = (id: string, greek: string, russian: string): Word => ({
  id,
  greek,
  russian,
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: iso,
  updatedAt: iso,
});
const phrase = (id: string, text: string): Phrase => ({
  id,
  text,
  translation: `${id}-ru`,
  createdAt: iso,
  updatedAt: iso,
});
const greekWords = Array.from({ length: 8 }, (_, i) => word(`w${i}`, `το λέξη${i}`, `слово${i}`));
const englishWords = Array.from({ length: 8 }, (_, i) => word(`e${i}`, `the word${i}`, `англ${i}`));
const greekPhrases = Array.from({ length: 4 }, (_, i) => phrase(`p${i}`, `Καλημέρα ${i}`));
const englishPhrases = Array.from({ length: 4 }, (_, i) => phrase(`ep${i}`, `Good morning ${i}`));

const lessons: Lesson[] = [
  { id: "g1", courseId: GREEK, title: "Γεια", completed: true, updatedAt: "2026-10-06T09:00:00Z" },
  { id: "g2", courseId: GREEK, title: "Καφές", completed: true, updatedAt: "2026-10-06T10:00:00Z" },
  { id: "e1", courseId: ENGLISH, title: "Work", completed: true, updatedAt: "2026-10-07T09:00:00Z" },
];
const composition: Record<string, { words: Word[]; phrases: Phrase[] }> = {
  g1: { words: greekWords.slice(0, 4), phrases: greekPhrases.slice(0, 2) },
  g2: { words: greekWords.slice(4), phrases: greekPhrases.slice(2) },
  e1: { words: englishWords, phrases: englishPhrases },
};
const items: LessonItem[] = Object.entries(composition).flatMap(([lessonId, { words, phrases }]) => [
  ...words.map((w, position) => ({ lessonId, unitKey: wordKeyOf(w.id), ref: wordRef(w.id), position })),
  ...phrases.map((p, index) => {
    const ref = { kind: "phrase" as const, id: p.id };
    return { lessonId, unitKey: unitKey(ref), ref, position: words.length + index };
  }),
]);
const module = (id: string, courseId: string, number: number, lessonIds: string[], position: number): StoredModule => ({
  id,
  courseId,
  number,
  title: id,
  subtitle: "",
  status: "published",
  goal: "",
  grammar: [],
  sessions: lessonIds.length,
  lessonIds,
  position,
});
// Номер английского модуля совпадает с первым греческим: общий порядок по номерам перемешал бы курсы.
const modules = [
  module("gm1", GREEK, 1, ["g1"], 0),
  module("gm2", GREEK, 2, ["g2"], 1),
  module("em1", ENGLISH, 1, ["e1"], 2),
];
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
// Английский стоит в каталоге раньше греческого: порядок курсов — порядок установки, а не каталога.
const catalog = [entry("e1", ENGLISH, "en", 0), entry("g1", GREEK, "el", 1), entry("g2", GREEK, "el", 2)];
const courseRows: Course[] = [
  { id: GREEK, title: "Греческий A2", calendar: GREEK_CALENDAR, exam: examOf(0.6), updatedAt: iso },
  { id: ENGLISH, title: "Английский", calendar: ENGLISH_CALENDAR, exam: examOf(0.7), updatedAt: iso },
];
function examOf(passShare: number) {
  return { title: "exam", date: "2027-05-01", source: "", checkedAt: "2026-10-01", localConfirmed: true, passShare };
}
const due = (key: string, ref: LessonItem["ref"]) => ({
  unitKey: key,
  ref,
  card: { ...createEmptyCard(new Date("2026-10-01T09:00:00Z")), due: new Date("2026-10-07T09:00:00Z") },
  introducedAt: "2026-10-01T09:00:00Z",
  version: 1,
});
// К повторению — по слову и фразе каждого курса.
const states = [
  due(wordKeyOf("w0"), wordRef("w0")),
  due(unitKey({ kind: "phrase", id: "p0" }), { kind: "phrase", id: "p0" }),
  due(wordKeyOf("e0"), wordRef("e0")),
  due(unitKey({ kind: "phrase", id: "ep0" }), { kind: "phrase", id: "ep0" }),
];

let db: AppDatabase;
async function seedCatalog(database: AppDatabase) {
  await database.transaction("rw", database.courses, database.catalog, database.modules, async () => {
    await database.courses.bulkAdd(courseRows);
    await database.catalog.bulkAdd(catalog);
    await database.modules.bulkAdd(modules);
  });
}
/** Уроки курса на устройстве: записи уроков, связи, карточки и их состояния. */
async function install(database: AppDatabase, courseId: string) {
  await database.transaction("rw", database.tables, async () => {
    const own = lessons.filter((lesson) => lesson.courseId === courseId);
    const ids = new Set(own.map((lesson) => lesson.id));
    await database.lessons.bulkAdd(own);
    await database.packages.bulkAdd(
      own.map((lesson) => ({
        lessonId: lesson.id,
        courseId,
        version: "1",
        schemaVersion: 4,
        installedAt: iso,
        words: [],
        phrases: [],
        items: [],
        media: [],
      })),
    );
    const links = items.filter((item) => ids.has(item.lessonId));
    await database.lessonItems.bulkAdd(links);
    await database.words.bulkAdd(own.flatMap((lesson) => composition[lesson.id].words).map(indexWord));
    await database.phrases.bulkAdd(own.flatMap((lesson) => composition[lesson.id].phrases));
    const live = new Set(links.map((item) => item.unitKey));
    await database.cardStates.bulkAdd(states.filter((state) => live.has(state.unitKey)));
  });
}
beforeEach(async () => {
  await new AppDatabase("tetradio-two-courses").delete();
  db = new AppDatabase("tetradio-two-courses");
  await seedCatalog(db);
  // Греческий установлен первым: порядок установки запоминается при обновлении каталога.
  await install(db, GREEK);
  await rememberCourses(db);
  await install(db, ENGLISH);
  await rememberCourses(db);
});
afterEach(() => db.close());

const ids = (refs: { id: string }[]) => refs.map((ref) => ref.id).sort();
const greekIds = new Set([...greekWords, ...greekPhrases].map((card) => card.id));
const englishIds = new Set([...englishWords, ...englishPhrases].map((card) => card.id));

describe("порядок курсов", () => {
  it("основной — установленный первым, а не первый в каталоге; смена основного запоминается", async () => {
    expect(await coursesOrder(db)).toEqual([GREEK, ENGLISH]);
    expect(await primaryCourse(db)).toBe(GREEK);
    await setPrimaryCourse(ENGLISH, db);
    expect(await coursesOrder(db)).toEqual([ENGLISH, GREEK]);
    expect(await primaryCourse(db)).toBe(ENGLISH);
  });
  it("без сохранённого порядка установленный курс идёт раньше неустановленного", async () => {
    await new AppDatabase("tetradio-two-courses-greek").delete();
    const fresh = new AppDatabase("tetradio-two-courses-greek");
    await seedCatalog(fresh);
    await install(fresh, GREEK);
    expect(await coursesOrder(fresh)).toEqual([GREEK, ENGLISH]);
    expect((await courses(fresh)).map((course) => [course.id, course.installed, course.language])).toEqual([
      [GREEK, true, "el"],
      [ENGLISH, false, "en"],
    ]);
    await rememberCourses(fresh);
    expect((await fresh.meta.get("coursesOrder"))?.value).toBe(JSON.stringify([GREEK]));
    fresh.close();
  });
  it("выбранный курс — основной, пока не выбран другой", async () => {
    expect(await currentCourse(db)).toBe(GREEK);
    await setCurrentCourse(ENGLISH, db);
    expect(await currentCourse(db)).toBe(ENGLISH);
    await setCurrentCourse("gone", db);
    expect(await currentCourse(db)).toBe(GREEK);
  });
});

describe("курс и язык карточки", () => {
  it("по урокам, в которых стоит карточка; карточка вне уроков — у основного курса", async () => {
    const owners = await courseOfCards([wordKeyOf("w0"), wordKeyOf("e3"), wordKeyOf("nowhere")], db);
    expect(Object.fromEntries(owners)).toEqual({ [wordKeyOf("w0")]: GREEK, [wordKeyOf("e3")]: ENGLISH });
    const languages = await cardLanguages([wordRef("w0"), { kind: "phrase", id: "ep1" }, wordRef("nowhere")], db);
    expect([...languages.values()]).toEqual(["el", "en", "el"]);
  });
});

describe("план и занятие по курсу", () => {
  it("порядок программы — по номерам модулей своего курса", async () => {
    expect((await studiedLessons(GREEK, db)).map((lesson) => lesson.id)).toEqual(["g1", "g2"]);
    expect((await studiedLessons(ENGLISH, db)).map((lesson) => lesson.id)).toEqual(["e1"]);
  });
  it("новые карточки и повторения не смешиваются", async () => {
    for (const [courseId, own] of [
      [GREEK, greekIds],
      [ENGLISH, englishIds],
    ] as const) {
      const plan = await makePlan(dexieSource(db), now, { courseId });
      expect(plan.newRefs.length).toBeGreaterThan(0);
      expect(plan.newRefs.every((ref) => own.has(ref.id))).toBe(true);
      expect(ids(plan.reviews.map((review) => review.ref))).toEqual(
        ids(states.filter((state) => own.has(state.ref.id)).map((state) => state.ref)),
      );
    }
    // Без курса план прежний: оба курса сразу.
    expect((await makePlan(dexieSource(db), now)).reviews).toHaveLength(4);
  });
  it("занятие курса — только его карточки и варианты из его слов, голос — по языку курса", async () => {
    const voices: string[] = [];
    const hasVoice = (language: string) => {
      voices.push(language);
      return language === "en";
    };
    const session = await makeSession({ source: dexieSource(db), now, courseId: ENGLISH, hasVoice, random: () => 0.3 });
    expect(session.courseId).toBe(ENGLISH);
    expect(session.items.length).toBeGreaterThan(0);
    expect(session.items.every((item) => englishIds.has(item.ref.id))).toBe(true);
    const englishTexts = new Set(englishWords.flatMap((w) => [w.greek, w.russian]));
    for (const item of session.items.filter((entry) => entry.card.kind === "word" && entry.options.length))
      expect(item.options.every((option) => englishTexts.has(option))).toBe(true);
    expect(new Set(voices)).toEqual(new Set(["en"]));

    const greek = await makeSession({ source: dexieSource(db), now, courseId: GREEK, random: () => 0.3 });
    expect(greek.items.every((item) => greekIds.has(item.ref.id))).toBe(true);
  });
  it("пул вариантов курса — только его слова", async () => {
    expect(ids(await optionPool(48, ENGLISH, db))).toEqual(ids(englishWords));
    expect(ids(await optionPool(3, GREEK, db)).every((id) => greekIds.has(id))).toBe(true);
    expect(await optionPool(3, GREEK, db)).toHaveLength(3);
  });
  it("снимок в памяти разделяет курсы так же, как база", async () => {
    const snapshot: Snapshot = {
      words: [...greekWords, ...englishWords],
      phrases: [...greekPhrases, ...englishPhrases],
      lessons,
      courses: courseRows,
      modules,
      links: [],
      items,
      states,
      events: [],
      sessions: [],
      languages: { [GREEK]: "el", [ENGLISH]: "en" },
    };
    for (const courseId of [GREEK, ENGLISH]) {
      const [fromDb, fromMemory] = await Promise.all([
        makePlan(dexieSource(db), now, { courseId, hasVoice: true }),
        makePlan(fromSnapshot(snapshot), now, { courseId, hasVoice: true }),
      ]);
      expect(fromMemory.newRefs).toEqual(fromDb.newRefs);
      expect(fromMemory.reviews.map((review) => review.ref)).toEqual(fromDb.reviews.map((review) => review.ref));
    }
  });
  it("прежнее занятие без курса — занятие основного курса", async () => {
    const old: Session = {
      ...(await makeSession({ source: dexieSource(db), now, courseId: GREEK, random: () => 0.3 })),
      id: "s-old",
    };
    delete old.courseId;
    await db.sessions.add(old);
    expect((await activeSession(GREEK, db))?.id).toBe("s-old");
    expect(await activeSession(ENGLISH, db)).toBeNull();
    const english = await makeSession({ source: dexieSource(db), now, courseId: ENGLISH, random: () => 0.3 });
    await db.sessions.add({ ...english, createdAt: new Date(now.getTime() + 1000).toISOString() });
    expect((await activeSession(ENGLISH, db))?.id).toBe(english.id);
    expect((await activeSession(GREEK, db))?.id).toBe("s-old");
  });
  it("дополнительная попытка прежнего занятия берёт варианты из слов основного курса", async () => {
    const made = await makeSession({ source: dexieSource(db), now, courseId: GREEK, random: () => 0.3 });
    delete made.courseId;
    // Понимание на слух проще узнавания: ошибка в нём читает пул вариантов для дополнительной попытки.
    const session = {
      ...made,
      items: made.items.map((entry) =>
        entry.card.kind === "word" ? { ...entry, type: "comprehension" as const } : entry,
      ),
    };
    await db.sessions.add(session);
    const item = session.items.find((entry) => entry.card.kind === "word")!;
    await recordAnswer({
      session,
      item,
      correct: false,
      answer: "",
      responseTimeMs: 4000,
      activeTimeMs: 0,
      timezone: "UTC",
      now,
      database: db,
    });
    const retry = (await db.sessions.get(session.id))!.items.find((entry) => entry.retryOf === item.id)!;
    expect(retry.type).toBe("recognition");
    const greekTexts = new Set(greekWords.flatMap((w) => [w.greek, w.russian]));
    expect(retry.options.every((option) => greekTexts.has(option))).toBe(true);
  });
});

describe("экраны курса", () => {
  it("модули, словарь и прогресс — выбранного курса, без курса — основного", async () => {
    expect((await moduleViews(ENGLISH, db)).map((view) => view.module.id)).toEqual(["em1"]);
    expect((await moduleViews(undefined, db)).map((view) => view.module.id)).toEqual(["gm1", "gm2"]);
    expect((await dictionary(ENGLISH, db)).map((lesson) => lesson.id)).toEqual(["e1"]);
    expect((await dictionary(undefined, db)).map((lesson) => lesson.id)).toEqual(["g1", "g2"]);
  });
  it("прогресс курса — его календарь, порог и неделя", async () => {
    const event = (id: string, wordId: string): ReviewEvent => ({
      id,
      sessionId: "s",
      itemId: id,
      ref: wordRef(wordId),
      unitKey: wordKeyOf(wordId),
      snapshot: { greek: "", russian: "" },
      type: "recognition",
      mode: "scheduled",
      rating: 3,
      correct: true,
      answer: "",
      createdAt: iso,
      localDate: "2026-10-08",
      responseTimeMs: 1000,
    });
    await db.events.bulkAdd([event("a", "w1"), event("b", "e1"), event("c", "e2")]);
    await db.blockProgress.add({ key: "e1/x", lessonId: "e1", blockId: "x", done: true, updatedAt: iso });
    const english = await courseProgress(now, "UTC", ENGLISH, db);
    expect(english.calendar).toEqual(ENGLISH_CALENDAR);
    expect(english.passShare).toBe(0.7);
    expect(english.views.map((view) => view.module.id)).toEqual(["em1"]);
    expect(english.week).toMatchObject({ cards: 2, lessonDays: ["2026-10-08"] });
    const greek = await courseProgress(now, "UTC", undefined, db);
    expect(greek.calendar).toEqual(GREEK_CALENDAR);
    expect(greek.passShare).toBe(0.6);
    expect(greek.week).toMatchObject({ cards: 1, lessonDays: [] });
    expect(await reviewedOn("2026-10-08", ENGLISH, db)).toBe(2);
    expect(await reviewedOn("2026-10-08", undefined, db)).toBe(3);
  });
});
