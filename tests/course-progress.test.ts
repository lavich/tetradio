import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import type { ExerciseBlock, LessonBlock } from "../src/content/course";
import { checkItem, lessonDone, scoreExercise, testResult, wordCount } from "../src/domain/course";
import type { BlockProgress } from "../src/domain/types";
import {
  blockProgressOf,
  completeLesson,
  courseLesson,
  LessonIncompleteError,
  moduleViews,
  nextCourseLesson,
  saveBlockProgress,
} from "../src/storage/course";
import { AppDatabase } from "../src/storage/db";
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
    );
    expect(result).toMatchObject({ correct: 3, total: 4, share: 0.75, passed: true });
    // Пропуски без текста — вне навыков; чтение: 1 из 2 = 50 % — не сдано.
    expect(result.skills).toEqual([{ skill: "reading", correct: 1, total: 2, share: 0.5, passed: false }]);
  });
});

describe("прогресс курса в базе", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    await new AppDatabase("tetradio-course").delete();
    db = new AppDatabase("tetradio-course");
    await installLessons(db, ["m01-1", "m01-test", "m01-k1"], memoryFetcher(demo));
  });

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

  it("выполнение блока сохраняется и дополняется; урок нельзя завершить раньше заданий", async () => {
    await saveBlockProgress("m01-1", "about-me", { text: "Με λένε Ιβάν." }, db);
    await saveBlockProgress("m01-1", "about-me", { done: true, checks: [0, 1] }, db);
    const saved = (await blockProgressOf("m01-1", db)).get("about-me")!;
    expect(saved).toMatchObject({ key: "m01-1/about-me", done: true, text: "Με λένε Ιβάν.", checks: [0, 1] });
    await expect(completeLesson("m01-1", db)).rejects.toBeInstanceOf(LessonIncompleteError);
    expect((await db.lessons.get("m01-1"))!.status).toBe("upcoming");
    for (const blockId of ["forms", "anna-tf", "cafe-q", "intro"])
      await saveBlockProgress("m01-1", blockId, { done: true }, db);
    await completeLesson("m01-1", db);
    expect((await db.lessons.get("m01-1"))!.status).toBe("completed");
    expect(await db.meta.get("sync:dirty")).toMatchObject({ value: "1" });
  });

  it("следующий шаг курса — первый незавершённый урок опубликованного модуля", async () => {
    expect((await nextCourseLesson("greek-a2", db))!.lesson.id).toBe("m01-1");
    await db.lessons.update("m01-1", { status: "completed" });
    expect((await nextCourseLesson("greek-a2", db))!.lesson.id).toBe("m01-test");
    await db.lessons.update("m01-test", { status: "completed" });
    // Уроки модуля пройдены — следующий шаг контрольная точка после него.
    expect((await nextCourseLesson("greek-a2", db))!.lesson).toMatchObject({ id: "m01-k1", kind: "test" });
    await db.lessons.update("m01-k1", { status: "completed" });
    // Черновик m02 следующим шагом не становится.
    expect(await nextCourseLesson("greek-a2", db)).toBeNull();
    expect((await moduleViews("greek-a2", db))[0].completed).toBe(true);
  });
});
