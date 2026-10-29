import "fake-indexeddb/auto";
import Dexie, { liveQuery } from "dexie";
import { Rating } from "ts-fsrs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildContent } from "../content/build";
import { makePlan, makeSession, nextState } from "../src/domain/learning";
import { unitKey, wordRef } from "../src/domain/refs";
import { progress } from "../src/domain/stats";
import { wordSources } from "../src/features/words/word-exercises";
import { courseLesson, lessonDays, moduleViews, nextCourseLesson, reviewedOn } from "../src/storage/course";
import {
  cardsInCourse,
  languageSession,
  courseOfCard,
  courses,
  currentLanguage,
  languages,
  lessonCourses,
  profileOfCourse,
  sessionLanguage,
  shelfLanguage,
} from "../src/storage/courses";
import { db, type StoredWord } from "../src/storage/db";
import { dictionary, languageDictionary } from "../src/storage/dictionary";
import { submitAnswer } from "./helpers/ops";
import { courseProgress, languageProgress } from "../src/storage/progress";
import { dexieSource } from "../src/storage/queries";
import { languagePlan, sessionHomeLanguage, todayCourses, todayLanguage } from "../src/storage/today";
import { PROFILES } from "../src/domain/language";
import { markRead, moduleReadings, courseReadings, languageReadings, readingPage } from "../src/storage/readings";
import { completeLessons, installLessons, memoryFetcher } from "./helpers/content";

const demo = buildContent("tests/fixtures/course-demo");
const now = new Date("2026-09-15T09:00:00Z");
const tz = "Asia/Nicosia";
const COURSE = "greek-a2";

// Чтение без подписки в зоне Dexie: изменение этих строк живой запрос не перезапустит.
const untracked: string[] = [];
let checking = false;
db.use({
  stack: "dbcore",
  name: "untracked-reads",
  level: 100,
  create: (down) => ({
    ...down,
    table: (name) => {
      const table = down.table(name);
      const check = (req: { trans: unknown }) => {
        const live = (Dexie.Promise as unknown as { PSD: { subscr?: object } }).PSD.subscr;
        if (checking && !live && (req.trans as IDBTransaction).mode === "readonly") untracked.push(name);
      };
      return {
        ...table,
        get: (req) => (check(req), table.get(req)),
        getMany: (req) => (check(req), table.getMany(req)),
        query: (req) => (check(req), table.query(req)),
        count: (req) => (check(req), table.count(req)),
        openCursor: (req) => (check(req), table.openCursor(req)),
      };
    },
  }),
});

function watch(query: () => unknown) {
  let runs = 0;
  let first: () => void;
  const answered = new Promise<void>((resolve) => (first = resolve));
  const subscription = liveQuery(() => (runs++, query()) as Promise<unknown>).subscribe({ next: () => first() });
  return { runs: () => runs, answered: () => answered, stop: () => subscription.unsubscribe() };
}

let wordId = "";
let word: StoredWord;
const key = () => unitKey(wordRef(wordId));

describe("живые запросы отслеживают чтения после вложенных async-функций", () => {
  beforeAll(async () => {
    await installLessons(db, ["m01-1", "m01-test", "m01-k1", "m01-r1"], memoryFetcher(demo));
    await completeLessons(db, ["m01-1"]);
    wordId = (await db.lessonItems.where("lessonId").equals("m01-1").toArray()).find(
      (item) => item.ref.kind === "word",
    )!.ref.id;
    word = (await db.words.get(wordId))!;
    const session = await makeSession({ source: dexieSource(db), now, random: () => 0.42, courseId: COURSE });
    await db.sessions.add(session);
    await submitAnswer({
      session,
      item: session.items[0],
      correct: true,
      answer: "",
      responseTimeMs: 1000,
      activeTimeMs: 1000,
      timezone: tz,
      now,
      database: db,
    });
  });
  afterAll(() => db.close());

  // Форма запроса (стрелка или async) — как в экране: от неё зависит, удержит ли Dexie зону.
  const screens: Record<string, () => unknown> = {
    "«Сегодня»: план": () => makePlan(dexieSource(), now, { courseId: COURSE }),
    "«Сегодня»: язык": async () => (await todayLanguage()) ?? null,
    "«Сегодня»: курсы языка": async () => todayCourses((await todayLanguage())!),
    "«Сегодня»: план языка": async () => languagePlan(now, (await todayLanguage()) ?? null),
    "«Сегодня»: занятие языка": async () => languageSession((await todayLanguage())!),
    "«Сегодня»: дни уроков языка": () => lessonDays("2026-09-14", tz, [COURSE]),
    "«Сегодня»: повторено по языку": () => reviewedOn("2026-09-15", [COURSE]),
    "«Сегодня»: дни уроков": () => lessonDays("2026-09-14", tz, COURSE),
    "«Сегодня»: повторено": () => reviewedOn("2026-09-15", COURSE),
    "«Сегодня»: «Чтение»": async () => courseReadings(COURSE),
    "«Курс»: полка курса": () => moduleViews(COURSE),
    "«Курс»: язык и его курсы": async () => {
      const code = await shelfLanguage();
      return (await languages()).find((language) => language.code === code) ?? null;
    },
    "«Слова»: язык": async () => (await currentLanguage()) ?? null,
    "обложка: гамма курса": async () => (await courses()).find((course) => course.id === COURSE)?.palette ?? null,
    модуль: async () => {
      const own = await db.modules.get("m01");
      return (await moduleViews(own?.courseId)).find((item) => item.module.id === "m01") ?? null;
    },
    "урок: страница": () => courseLesson("m01-1"),
    "урок: следующий": () => nextCourseLesson(COURSE),
    "урок: язык": async () => {
      const courseId = (await lessonCourses(["m01-1"])).get("m01-1");
      return courseId ? profileOfCourse(courseId) : null;
    },
    "модуль: тексты": () => moduleReadings("m01"),
    "«Чтение»": async () => languageReadings(await currentLanguage()),
    текст: async () => (await readingPage("r-m01-anna")) ?? null,
    "«Слова»": async () => {
      const language = await currentLanguage();
      return { language, lessons: await languageDictionary(language) };
    },
    "«Прогресс»: словарь": async () => languageDictionary(await currentLanguage()),
    "«Прогресс»": () => courseProgress(now, tz, COURSE),
    "«Прогресс»: язык": async () => languageProgress(now, tz, await currentLanguage()),
    "«Прогресс»: статистика": () => progress(dexieSource(), now),
    "«Прогресс»: трудные": async () => (await cardsInCourse([key()], [COURSE])).size,
    "слово: упражнения": () => wordSources(wordId),
    "слово: навыки": () => dexieSource().skillsOf({ kind: "word", word }),
    "слово: язык": async () => profileOfCourse((await courseOfCard(key()))!),
    занятие: async () => {
      const found = await languageSession(await sessionHomeLanguage());
      if (!found) return { session: null, profile: undefined };
      return { session: found, profile: PROFILES[await sessionLanguage(found)] };
    },
  };

  for (const [name, query] of Object.entries(screens))
    it(`${name}: каждое чтение попадает в подписку`, async () => {
      untracked.length = 0;
      checking = true;
      await new Promise((resolve) => {
        const subscription = liveQuery(query as () => Promise<unknown>).subscribe({
          next: () => (subscription.unsubscribe(), resolve(undefined)),
        });
      });
      checking = false;
      expect(untracked).toEqual([]);
    });

  it("словарь «Прогресса» обновляет отметки после ответа", async () => {
    const words = watch(() => dictionary(COURSE));
    await words.answered();
    const ran = words.runs();
    await db.cardStates.put(nextState(undefined, wordRef(wordId), Rating.Good, now));
    await vi.waitFor(() => expect(words.runs()).toBeGreaterThan(ran));
    words.stop();
  });

  it("статистика «Прогресса» обновляется после изменения карточки", async () => {
    const stats = watch(() => progress(dexieSource(), now));
    await stats.answered();
    const ran = stats.runs();
    await db.cardStates.put(nextState(undefined, wordRef(wordId), Rating.Again, now));
    await vi.waitFor(() => expect(stats.runs()).toBeGreaterThan(ran));
    stats.stop();
  });

  it("тексты модуля обновляют отметку «прочитано»", async () => {
    const texts = watch(() => moduleReadings("m01"));
    await texts.answered();
    const ran = texts.runs();
    await markRead("r-m01-anna", true);
    await vi.waitFor(() => expect(texts.runs()).toBeGreaterThan(ran));
    texts.stop();
  });

  it("упражнения слова обновляются после изменения уроков", async () => {
    const options = watch(() => wordSources(wordId));
    await options.answered();
    const ran = options.runs();
    await db.lessons.update("m01-1", { title: "Новое название" });
    await vi.waitFor(() => expect(options.runs()).toBeGreaterThan(ran));
    options.stop();
  });
});
