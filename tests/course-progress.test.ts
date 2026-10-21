import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import type { ExerciseBlock, LessonBlock } from "../src/content/course";
import { checkItem, lessonDone, scoreExercise, testResult, wordCount } from "../src/domain/course";
import type { BlockProgress } from "../src/domain/types";
import {
  blockProgressOf,
  completeLesson,
  courseLesson,
  LessonIncompleteError,
  type ModuleLessonView,
  type ModuleView,
  courseFinished,
  moduleViews,
  nextCourseLesson,
  nextStep,
  saveBlockProgress,
} from "../src/storage/course";
import { AppDatabase } from "../src/storage/db";
import { courseProgress, languageProgress } from "../src/storage/progress";
import { installLessons, memoryFetcher } from "./helpers/content";

/** Демонстрационный курс: модуль m01 (урок и контрольная) и черновик m02. */
const demo = buildContent("tests/fixtures/course-demo");
const lessonPack = demo.packages.find((p) => p.id === "m01-1")!;
const block = (id: string) => lessonPack.blocks!.find((b) => b.id === id)! as ExerciseBlock;
const progress = (rows: Partial<BlockProgress>[]) =>
  new Map(rows.map((row) => [row.blockId!, { done: true, ...row } as BlockProgress]));

describe("проверка ответа по ключу", () => {
  it("выбор сравнивается с вариантом точно", () => {
    const forms = block("forms");
    expect(checkItem(forms, forms.items[0], "είμαι")).toEqual({ status: "correct", expected: "είμαι" });
    expect(checkItem(forms, forms.items[0], "είσαι").status).toBe("wrong");
  });
  it("ввод прощает регистр, пробелы и конечную ς, а пропущенное ударение даёт «почти»", () => {
    const cafe = block("cafe-q");
    expect(checkItem(cafe, cafe.items[1], "  Από την  Ελλάδα ").status).toBe("correct");
    expect(checkItem(cafe, cafe.items[1], "απο την Ελλαδα")).toEqual({ status: "almost", expected: "από την Ελλάδα" });
    expect(checkItem(cafe, cafe.items[0], "Μαρια").status).toBe("almost");
    expect(checkItem(cafe, cafe.items[0], "Άννα").status).toBe("wrong");
  });
  it("конечная точка, «;» и «!» ответ не меняют, а ключ показывается с пунктуацией", () => {
    const cafe = block("cafe-q");
    const withPoint = { ...cafe.items[1], answer: ["Είναι από την Ελλάδα."] };
    expect(checkItem(cafe, withPoint, "Είναι από την Ελλάδα")).toEqual({
      status: "correct",
      expected: "Είναι από την Ελλάδα.",
    });
    expect(checkItem(cafe, { ...withPoint, answer: ["Από πού είσαι;"] }, "Από πού είσαι").status).toBe("correct");
    expect(checkItem(cafe, withPoint, "Είναι από την Ελλάδα!").status).toBe("correct");
    // Греческий вопросительный знак U+037E выглядит как «;», но это другой символ.
    expect(checkItem(cafe, { ...withPoint, answer: ["Από πού είσαι\u037e"] }, "Από πού είσαι").status).toBe("correct");
    // Пунктуация внутри ответа по-прежнему значима.
    expect(checkItem(cafe, { ...withPoint, answer: ["Καλά, ευχαριστώ."] }, "Καλά ευχαριστώ").status).toBe("wrong");
  });
  it("в номерах пробелы и дефисы между цифрами не важны", () => {
    const cafe = block("cafe-q");
    const phone = { ...cafe.items[0], answer: ["96315802"] };
    for (const given of ["96 31 58 02", "96-31-58-02", "96315802"])
      expect(checkItem(cafe, phone, given).status).toBe("correct");
    expect(checkItem(cafe, phone, "96 31 58 03").status).toBe("wrong");
    const time = { ...cafe.items[0], answer: ["19:45"] };
    for (const given of ["19.45", "19,45", "19:45"]) expect(checkItem(cafe, time, given).status).toBe("correct");
    expect(checkItem(cafe, { ...cafe.items[0], answer: ["7,50 €"] }, "7.50 €").status).toBe("correct");
    const date = { ...cafe.items[0], answer: ["06.04"] };
    for (const given of ["6.04", "6/04", "06/04"]) expect(checkItem(cafe, date, given).status).toBe("correct");
    expect(checkItem(cafe, { ...cafe.items[0], answer: ["09:30"] }, "9.30").status).toBe("correct");
    expect(checkItem(cafe, { ...cafe.items[0], answer: ["10,05 €"] }, "10.5 €").status).toBe("wrong");
    expect(checkItem(cafe, { ...cafe.items[0], answer: ["10"] }, "100").status).toBe("wrong");
  });
  it("счёт задания: неотвеченный пункт — неверный", () => {
    const score = scoreExercise(block("anna-tf"), { q1: "Λάθος" });
    expect(score).toMatchObject({ correct: 1, almost: 0, total: 2 });
    expect(score.results.q2.status).toBe("wrong");
  });
  it("соединение сравнивается с вариантом банка точно: без «почти», неотвеченный и чужой вариант — неверно", () => {
    const pairs = demo.packages.find((p) => p.id === "m01-r1")!.blocks!.find((b) => b.id === "pairs") as ExerciseBlock;
    expect(pairs).toMatchObject({ format: "match", bank: ["είμαι", "είσαι", "είναι", "είμαστε"] });
    const [m1, , m3] = pairs.items;
    expect(checkItem(pairs, m1, "είμαι")).toEqual({ status: "correct", expected: "είμαι" });
    expect(checkItem(pairs, m1, "είμαι".normalize("NFD")).status).toBe("correct");
    expect(checkItem(pairs, m1, "ειμαι").status).toBe("wrong");
    expect(checkItem(pairs, m3, "είναι")).toEqual({ status: "wrong", expected: "είμαστε" });
    const all = scoreExercise(pairs, { m1: "είμαι", m2: "είσαι", m3: "είμαστε" });
    expect(all).toMatchObject({ correct: 3, almost: 0, total: 3 });
    const partly = scoreExercise(pairs, { m1: "είμαι", m3: "είναι" });
    expect(partly).toMatchObject({ correct: 1, almost: 0, total: 3 });
    expect([partly.results.m2.status, partly.results.m3.status]).toEqual(["wrong", "wrong"]);
  });
  it("слова письма считаются без пунктуации", () => {
    expect(wordCount("Γεια σας! Με λένε Ιβάν. — ")).toBe(5);
  });
});

describe("завершённость урока и итог контрольной", () => {
  const blocks = lessonPack.blocks as LessonBlock[];
  it("урок пройден, когда выполнены все задания, письмо и речь; объяснение и чтение — через задания", () => {
    const tasks = ["forms", "anna-tf", "cafe-q", "about-me", "intro"];
    expect(lessonDone(blocks, progress(tasks.map((blockId) => ({ blockId }))))).toBe(true);
    expect(lessonDone(blocks, progress(tasks.slice(0, 4).map((blockId) => ({ blockId }))))).toBe(false);
    // Просмотренное объяснение не делает урок пройденным.
    expect(lessonDone(blocks, progress([{ blockId: "eimai" }, { blockId: "words" }]))).toBe(false);
  });
  it("контрольная считает оцениваемые задания по навыкам против порога 60 %", () => {
    const exam = demo.packages.find((p) => p.id === "m01-test")!.blocks!;
    const result = testResult(
      exam,
      progress([
        { blockId: "card-tf", score: { correct: 1, almost: 0, total: 2 } },
        { blockId: "gaps", score: { correct: 1, almost: 1, total: 2 } },
      ]),
      0.6,
    );
    expect(result).toMatchObject({ correct: 3, total: 4, share: 0.75, passed: true });
    // Пропуски без текста — вне навыков; чтение: 1 из 2 = 50 % — не сдано.
    expect(result.skills).toEqual([{ skill: "reading", correct: 1, total: 2, share: 0.5, passed: false }]);
  });
  it("без порога в экзамене курса итог контрольной не говорит о сдаче", () => {
    const exam = demo.packages.find((p) => p.id === "m01-test")!.blocks!;
    const result = testResult(
      exam,
      progress([{ blockId: "card-tf", score: { correct: 1, almost: 0, total: 2 } }]),
      undefined,
    );
    expect(result).toMatchObject({ correct: 1, total: 4, share: 0.25, passed: undefined });
    expect(result.skills).toEqual([{ skill: "reading", correct: 1, total: 2, share: 0.5, passed: undefined }]);
  });
});

describe("прогресс курса в базе", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    await new AppDatabase("tetradio-course").delete();
    db = new AppDatabase("tetradio-course");
    await installLessons(db, ["m01-1", "m01-test", "m01-k1", "m01-r1"], memoryFetcher(demo));
  });
  afterEach(() => db.close());

  it("каталог приносит модули, в том числе черновик без уроков; пакет — блоки урока", async () => {
    const views = await moduleViews("greek-a2", db);
    expect(views.map((view) => [view.module.id, view.module.status, view.lessons.length])).toEqual([
      ["m01", "published", 2],
      ["m02", "draft", 0],
    ]);
    expect(views[0].lessons[0]).toMatchObject({
      id: "m01-1",
      installed: true,
      completed: false,
      tally: { done: 0, total: 5 },
    });
    const lesson = await courseLesson("m01-1", db);
    expect(lesson).toMatchObject({ moduleId: "m01", position: 0, kind: "lesson" });
    expect(lesson!.blocks).toHaveLength(9);
    expect(await courseLesson("m02-1", db)).toBeNull();
  });

  it("выполнение блока сохраняется и дополняется; урок завершается сам с последним заданием", async () => {
    await saveBlockProgress("m01-1", "about-me", { text: "Με λένε Ιβάν." }, db);
    await saveBlockProgress("m01-1", "about-me", { done: true, checks: [0, 1] }, db);
    const saved = (await blockProgressOf("m01-1", db)).get("about-me")!;
    expect(saved).toMatchObject({ key: "m01-1/about-me", done: true, text: "Με λένε Ιβάν.", checks: [0, 1] });
    await expect(completeLesson("m01-1", db)).rejects.toBeInstanceOf(LessonIncompleteError);
    expect((await db.lessons.get("m01-1"))!.completed).toBe(false);
    for (const blockId of ["forms", "anna-tf", "cafe-q"]) await saveBlockProgress("m01-1", blockId, { done: true }, db);
    await saveBlockProgress("m01-1", "intro", { done: false, answers: { a: "x" } }, db);
    expect((await db.lessons.get("m01-1"))!.completed).toBe(false);
    await saveBlockProgress("m01-1", "intro", { done: true }, db);
    expect((await db.lessons.get("m01-1"))!.completed).toBe(true);
    expect((await db.meta.get("sync:dirty"))?.value).toBeTruthy();
  });

  it("следующий шаг курса — первый незавершённый урок опубликованного модуля", async () => {
    const step = async () => nextStep(await moduleViews("greek-a2", db));
    expect((await nextCourseLesson("greek-a2", db))!.lesson.id).toBe("m01-1");
    expect((await step())!.lesson.id).toBe("m01-1");
    await db.lessons.update("m01-1", { completed: true });
    expect((await nextCourseLesson("greek-a2", db))!.lesson.id).toBe("m01-test");
    expect((await step())!.lesson.id).toBe("m01-test");
    await db.lessons.update("m01-test", { completed: true });
    expect((await nextCourseLesson("greek-a2", db))!.lesson).toMatchObject({ id: "m01-k1", kind: "test" });
    expect((await step())!.lesson.id).toBe("m01-k1");
    await db.lessons.update("m01-k1", { completed: true });
    expect((await nextCourseLesson("greek-a2", db))!.lesson).toMatchObject({ id: "m01-r1", kind: "lesson" });
    expect((await step())!.lesson.id).toBe("m01-r1");
    await db.lessons.update("m01-r1", { completed: true });
    expect(await nextCourseLesson("greek-a2", db)).toBeNull();
    expect(await step()).toBeNull();
    expect(courseFinished(await moduleViews("greek-a2", db), null)).toBe(true);
    expect((await moduleViews("greek-a2", db))[0].completed).toBe(true);
  });

  it("курс из одних черновиков не считается пройденным", () => {
    const draft = { module: { status: "draft" } } as ModuleView;
    const published = { module: { status: "published" } } as ModuleView;
    expect(courseFinished([draft], null)).toBe(false);
    expect(courseFinished([], null)).toBe(false);
    expect(courseFinished([draft, published], null)).toBe(true);
    expect(courseFinished([published], { view: published, lesson: {} as ModuleLessonView })).toBe(false);
  });
});

describe("прогресс языка", () => {
  const two = buildContent("tests/fixtures/two-courses");
  const now = new Date("2026-10-21T09:00:00Z");
  const tz = "UTC";
  let db: AppDatabase;
  beforeEach(async () => {
    await new AppDatabase("tetradio-language-progress").delete();
    db = new AppDatabase("tetradio-language-progress");
    await installLessons(db, ["m01-1", "e01-1", "e01-test", "c01-1"], memoryFetcher(two));
  });
  afterEach(() => db.close());
  const reading = (skills: { skill: string; earned: number; total: number; attempted: number }[]) =>
    skills.find((item) => item.skill === "reading")!;

  it("навыки суммы — по заданиям обоих курсов языка, а не среднее долей; греческие задания не входят", async () => {
    await saveBlockProgress("e01-1", "text-tf", { done: true, score: { correct: 1, almost: 0, total: 1 } }, db);
    await saveBlockProgress("m01-1", "anna-tf", { done: true, score: { correct: 2, almost: 0, total: 2 } }, db);
    const english = await languageProgress(now, tz, "en", db);
    expect(english.courses.map((course) => course.course.id)).toEqual(["english", "talk"]);
    const [it, talk] = english.courses.map((course) => reading(course.skills));
    const total = reading(english.total.skills);
    expect(total.total).toBe(it.total + talk.total);
    expect(total.earned).toBe(it.earned + talk.earned);
    expect(total.attempted).toBe(it.attempted + talk.attempted);
    expect(total.earned).toBe(1);
  });
  it("итог недели — занятия всех курсов языка и дни повторения их карточек", async () => {
    const done = (lessonId: string, updatedAt: string) =>
      db.blockProgress.put({ key: `${lessonId}/text-tf`, lessonId, blockId: "text-tf", done: true, updatedAt });
    await done("e01-1", "2026-10-19T09:00:00.000Z");
    await done("c01-1", "2026-10-20T09:00:00.000Z");
    await done("m01-1", "2026-10-21T08:00:00.000Z");
    const week = (await languageProgress(now, tz, "en", db)).total.week;
    expect(week.lessonDays).toEqual(["2026-10-19", "2026-10-20"]);
    expect(week.monday).toBe("2026-10-19");
  });
  it("у языка с одним курсом блок курса — прежний прогресс курса", async () => {
    const greek = await languageProgress(now, tz, "el", db);
    expect(greek.courses).toHaveLength(1);
    expect(greek.courses[0]).toMatchObject(await courseProgress(now, tz, "greek-a2", db));
  });
});
