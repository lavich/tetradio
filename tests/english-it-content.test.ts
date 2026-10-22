import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wordCount } from "../src/domain/course";
import { parseCatalog } from "../src/content/schema";
import { moduleViews, nextStep } from "../src/storage/course";
import { AppDatabase } from "../src/storage/db";
import { completeLessons, installLessons, memoryFetcher } from "./helpers/content";
import { realContent } from "./helpers/real-content";

const content = realContent();
const catalog = parseCatalog(JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string));
const modulesOf = (courseId: string) => catalog.modules!.filter((module) => module.courseId === courseId);
const packagesOf = (courseId: string) => content.packages.filter((pack) => pack.courseId === courseId);

const MAX_LINE_WORDS = 90;
const MAX_SOURCE_BYTES = 60_000;
const MAX_TEXT_VARIANTS = 200;

type Blocks = NonNullable<ReturnType<typeof realContent>["packages"][number]["blocks"]>;

const sourceBytes = (source: string) =>
  Buffer.byteLength(source.replace(/,\s*audio:\s*[^\s,}]+/g, "").replace(/^[ \t]*audio:.*(\n|$)/gm, ""));
const longestLineWords = (blocks: Blocks) =>
  Math.max(
    0,
    ...blocks.flatMap((block) =>
      block.type === "listening" ? block.transcript.map((line) => wordCount(line.text)) : [],
    ),
  );
const maxTextVariants = (blocks: Blocks) =>
  Math.max(
    0,
    ...blocks.flatMap((block) =>
      block.type === "exercise" && block.format === "text" ? block.items.map((item) => item.answer.length) : [],
    ),
  );

describe("размер источников ступени B2 (функции проверены на синтетических данных)", () => {
  const listening = (words: number) =>
    [
      {
        type: "listening",
        id: "l",
        title: "l",
        plays: 2,
        transcript: [{ speaker: "Mark", text: Array.from({ length: words }, () => "word").join(" ") }],
      },
    ] as unknown as Blocks;
  const exercise = (variants: number) =>
    [
      {
        type: "exercise",
        id: "x",
        title: "x",
        instruction: "x",
        format: "text",
        items: [{ id: "q1", prompt: "q", answer: Array.from({ length: variants }, (_, i) => `variant ${i}`) }],
      },
    ] as unknown as Blocks;

  it("реплика в 120 слов не проходит предел, в 90 слов проходит", () => {
    expect(longestLineWords(listening(120))).toBeGreaterThan(MAX_LINE_WORDS);
    expect(longestLineWords(listening(90))).toBeLessThanOrEqual(MAX_LINE_WORDS);
  });

  it("пункт text в 300 вариантов не проходит предел, в 200 проходит", () => {
    expect(maxTextVariants(exercise(300))).toBeGreaterThan(MAX_TEXT_VARIANTS);
    expect(maxTextVariants(exercise(200))).toBeLessThanOrEqual(MAX_TEXT_VARIANTS);
  });

  it("источник в 61 000 байт не проходит предел, в 59 000 проходит; строки audio: не считаются", () => {
    expect(sourceBytes("a".repeat(61_000))).toBeGreaterThan(MAX_SOURCE_BYTES);
    expect(sourceBytes("a".repeat(59_000))).toBeLessThanOrEqual(MAX_SOURCE_BYTES);
    const line = '      - { speaker: Mark, text: "Hello.", audio: e09-2/call-1.mp3 }\n';
    const bare = '      - { speaker: Mark, text: "Hello." }\n';
    expect(sourceBytes(line.repeat(100))).toBe(Buffer.byteLength(bare.repeat(100)));
    expect(sourceBytes("title: x\n  audio: words/ew1.mp3\n")).toBe(Buffer.byteLength("title: x\n"));
  });
});

describe("английский для IT: ступень B1+ и B2", () => {
  const STAGE_1 = ["e01", "e02", "e03", "e04", "e05", "e06", "e07", "e08"];
  const STAGE_2 = ["e09", "e10", "e11", "e12", "e13", "e14", "e15", "e16"];
  const STAGE = [...STAGE_1, ...STAGE_2];
  const WRITING: Record<string, { register: string; min: number; max: number }> = {
    e01: { register: "formal", min: 60, max: 90 },
    e02: { register: "formal", min: 60, max: 90 },
    e03: { register: "formal", min: 60, max: 100 },
    e04: { register: "formal", min: 60, max: 100 },
    e05: { register: "formal", min: 80, max: 120 },
    e06: { register: "formal", min: 80, max: 120 },
    e07: { register: "formal", min: 80, max: 120 },
    e08: { register: "formal", min: 80, max: 120 },
    e09: { register: "formal", min: 80, max: 120 },
    e10: { register: "formal", min: 80, max: 120 },
    e11: { register: "formal", min: 80, max: 120 },
    e12: { register: "formal", min: 80, max: 120 },
    e13: { register: "formal", min: 130, max: 170 },
    e14: { register: "formal", min: 130, max: 170 },
    e15: { register: "formal", min: 130, max: 170 },
    e16: { register: "formal", min: 130, max: 170 },
  };
  const WORDS = [18, 17];
  const PHRASES = [8, 8, 9];
  const lessonOf = (id: string) => packagesOf("english-it").find((pack) => pack.id === id);
  const blocksOf = (id: string) => lessonOf(id)!.blocks!;
  const cardIds = (prefix: string, perModule: number, number: number) =>
    Array.from(
      { length: perModule },
      (_, i) => `${prefix}${String(perModule * (number - 1) + i + 1).padStart(3, "0")}`,
    );
  const speakersOf = (courseId: string) =>
    new Set(
      packagesOf(courseId)
        .flatMap((pack) => pack.blocks ?? [])
        .flatMap((block) => (block.type === "listening" ? block.transcript.map((line) => line.speaker) : [])),
    );
  const TRAVEL_NAMES = speakersOf("english-travel");

  it("модули вне ступени — черновики, частично опубликованных нет", () => {
    const modules = modulesOf("english-it");
    expect(modules.map((m) => m.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `e${String(i + 1).padStart(2, "0")}`),
    );
    for (const module of modules.filter((m) => !STAGE.includes(m.id))) expect(module.status, module.id).toBe("draft");
    expect(content.partial).toEqual([]);
  });

  describe.each(STAGE)("модуль %s", (moduleId) => {
    const module = () => modulesOf("english-it").find((m) => m.id === moduleId)!;
    const lessonIds = ["1", "2", "3", "test"].map((suffix) => `${moduleId}-${suffix}`);
    const [first, second, third, test] = lessonIds;

    it("опубликован полностью: три урока и контрольная, шпаргалка", () => {
      expect(module()).toMatchObject({ status: "published", lessonIds });
      expect(module().crib, moduleId).toBeDefined();
      expect(lessonOf(test)!.lesson.kind).toBe("test");
    });

    it("35 слов и 25 фраз модуля — по урокам 18 + 17 и 8 + 8 + 9, каждая в одном; IPA, перевод, происхождение", () => {
      const ids = (kind: "words" | "phrases", lesson: string) => lessonOf(lesson)![kind].map((card) => card.id);
      const words = [first, second].map((id) => ids("words", id));
      const phrases = [first, second, third].map((id) => ids("phrases", id));
      expect(words.map((list) => list.length)).toEqual(WORDS);
      expect(phrases.map((list) => list.length)).toEqual(PHRASES);
      expect(words.flat().sort()).toEqual(cardIds("ew", 35, module().number));
      expect(phrases.flat().sort()).toEqual(cardIds("ep", 25, module().number));
      expect(ids("words", third)).toEqual([]);
      expect(lessonOf(test)!.words).toEqual([]);
      expect(lessonOf(test)!.phrases).toEqual([]);
      for (const id of [first, second, third])
        expect(
          blocksOf(id).some((block) => block.type === "vocabulary"),
          id,
        ).toBe(true);
      for (const word of [first, second].flatMap((id) => lessonOf(id)!.words)) {
        expect(word.ipa, word.greek).toMatch(/^\/.+\/$/);
        expect(word.russian, word.greek).toBeTruthy();
      }
      for (const phrase of [first, second, third].flatMap((id) => lessonOf(id)!.phrases)) {
        expect(phrase.translation, phrase.text).toBeTruthy();
        expect(content.sources.phrases.get(phrase.id)!.provenance).toMatchObject({ operation: "requested-generation" });
      }
    });

    it("первый урок: объяснение с таблицей, слова урока, не меньше четырёх заданий", () => {
      const blocks = blocksOf(first);
      expect(blocks.some((block) => block.type === "explanation" && block.table)).toBe(true);
      expect(blocks.some((block) => block.type === "vocabulary")).toBe(true);
      expect(blocks.filter((block) => block.type === "exercise").length).toBeGreaterThanOrEqual(4);
    });

    it("второй урок: чтение и аудирование с заданиями, аудио звучит дважды", () => {
      const blocks = blocksOf(second);
      const about = (id: string) => blocks.some((block) => block.type === "exercise" && block.about === id);
      const sources = blocks.filter((block) => block.type === "reading" || block.type === "listening");
      expect(sources.some((block) => block.type === "reading")).toBe(true);
      expect(sources.some((block) => block.type === "listening")).toBe(true);
      for (const block of sources) expect(about(block.id), block.id).toBe(true);
      for (const block of blocks) if (block.type === "listening") expect(block.plays, block.id).toBe(2);
    });

    it("третий урок: письмо в границах программы, два устных задания с вопросом интервьюера, образцы и критерии", () => {
      const blocks = blocksOf(third);
      const expected = WRITING[moduleId]!;
      const writing = blocks.filter((block) => block.type === "writing");
      expect(writing.length).toBeGreaterThanOrEqual(1);
      for (const block of writing) {
        expect(block.register, block.id).toBe(expected.register);
        expect(block.words, block.id).toEqual({ min: expected.min, max: expected.max });
        expect(wordCount(block.model), block.id).toBeGreaterThanOrEqual(block.words.min);
        expect(wordCount(block.model), block.id).toBeLessThanOrEqual(block.words.max);
        expect(block.criteria.length, block.id).toBeGreaterThan(0);
      }
      for (const block of blocks) if (block.type === "listening") expect(block.plays, block.id).toBe(2);
      const speaking = blocks.filter((block) => block.type === "speaking");
      expect(speaking.length).toBeGreaterThanOrEqual(2);
      for (const block of speaking) {
        expect(block.model, block.id).toBeTruthy();
        expect(block.criteria.length, block.id).toBeGreaterThan(0);
      }
      expect(
        speaking.some((block) => block.part !== "roleplay" && /«[^»]+\?»/.test(block.prompt)),
        "вопрос интервьюера в «»",
      ).toBe(true);
      const number = module().number;
      if (number >= 2 && number <= 4)
        for (const block of speaking) expect(block.seconds, block.id).toBeLessThanOrEqual(60);
      if (number >= 5) {
        const limit = number >= 13 ? 180 : 120;
        for (const block of speaking) expect(block.seconds, block.id).toBeLessThanOrEqual(limit);
        expect(speaking.some((block) => block.seconds >= (number >= 9 ? 90 : 60))).toBe(true);
        expect(speaking.some((block) => block.part === "roleplay")).toBe(true);
        blocks.forEach((block, i) => {
          if (block.type !== "speaking" || block.part !== "roleplay") return;
          const before = blocks[i - 1];
          expect(before?.type, block.id).toBe("listening");
          expect(
            blocks.some((other) => other.type === "exercise" && other.about === before?.id),
            block.id,
          ).toBe(false);
        });
      }
    });

    it("контрольная: оцениваемые задания к чтению и к аудированию", () => {
      const blocks = blocksOf(test);
      const kindOf = (id?: string) => blocks.find((block) => block.id === id)?.type;
      const graded = blocks.filter((block) => block.type === "exercise" && block.graded);
      const skills = new Set(graded.map((block) => (block.type === "exercise" ? kindOf(block.about) : undefined)));
      expect(skills.has("reading")).toBe(true);
      expect(skills.has("listening")).toBe(true);
      for (const block of blocks) if (block.type === "listening") expect(block.plays, block.id).toBe(2);
    });

    if (STAGE_2.includes(moduleId))
      it("размер: строка аудирования не длиннее 90 слов, пункт text не больше 200 вариантов, исходник не больше 60 000 байт", () => {
        for (const id of lessonIds) {
          expect(longestLineWords(blocksOf(id)), id).toBeLessThanOrEqual(MAX_LINE_WORDS);
          expect(maxTextVariants(blocksOf(id)), id).toBeLessThanOrEqual(MAX_TEXT_VARIANTS);
          expect(
            sourceBytes(readFileSync(new URL(`../content/lessons/${id}.yaml`, import.meta.url), "utf8")),
            id,
          ).toBeLessThanOrEqual(MAX_SOURCE_BYTES);
        }
      });

    it("говорящие — в карте голосов en и не из курса для путешествий", () => {
      const cast = content.sources.voices.get("en")!.characters;
      const speakers = new Set(
        lessonIds
          .flatMap((id) => blocksOf(id))
          .flatMap((block) => (block.type === "listening" ? block.transcript.map((line) => line.speaker) : [])),
      );
      speakers.delete(undefined);
      expect(TRAVEL_NAMES.size).toBeGreaterThan(0);
      for (const speaker of speakers) {
        expect(cast.has(speaker!), speaker).toBe(true);
        expect(TRAVEL_NAMES.has(speaker), speaker).toBe(false);
      }
    });
  });

  describe("контрольная точка «Пробный звонок рекрутера»", () => {
    const blocks = () => blocksOf("e08-c1");
    const stageLessons = STAGE_1.flatMap((moduleId) =>
      ["1", "2", "3", "test"].map((suffix) => `${moduleId}-${suffix}`),
    );
    let db: AppDatabase;
    beforeEach(async () => {
      await new AppDatabase("tetradio-it-checkpoint").delete();
      db = new AppDatabase("tetradio-it-checkpoint");
      await installLessons(db, [...stageLessons, "e08-c1"], memoryFetcher(content));
    });
    afterEach(() => db.close());
    const step = async () => nextStep(await moduleViews("english-it", db));

    it("уроки e01–e08 пройдены — следующий шаг курса «Пробный звонок рекрутера»", async () => {
      await completeLessons(db, stageLessons);
      expect((await step())!.lesson).toMatchObject({
        id: "e08-c1",
        title: "Пробный звонок рекрутера",
        kind: "test",
      });
    });

    it("контрольная e03-test не пройдена — следующий шаг она, а не точка", async () => {
      await completeLessons(
        db,
        stageLessons.filter((id) => id !== "e03-test"),
      );
      expect((await step())!.lesson.id).toBe("e03-test");
    });

    it("стоит после e08, контрольная без карточек, заголовок без «C1» и «CEFR»", () => {
      expect(modulesOf("english-it").find((m) => m.id === "e08")!.checkpointId).toBe("e08-c1");
      const pack = lessonOf("e08-c1")!;
      expect(pack.lesson.kind).toBe("test");
      expect(pack.lesson.title).toBe("Пробный звонок рекрутера");
      expect(pack.lesson.title).not.toMatch(/C1|CEFR/i);
      expect(pack.words).toEqual([]);
      expect(pack.phrases).toEqual([]);
      expect(pack.items).toEqual([]);
    });

    it("чтение и аудирование — не меньше 10 оцениваемых пунктов на навык", () => {
      const kindOf = (id?: string) => blocks().find((block) => block.id === id)?.type;
      const itemsOf = (skill: string) =>
        blocks()
          .filter((block) => block.type === "exercise" && block.graded && kindOf(block.about) === skill)
          .reduce((sum, block) => sum + (block.type === "exercise" ? block.items.length : 0), 0);
      expect(itemsOf("reading")).toBeGreaterThanOrEqual(10);
      expect(itemsOf("listening")).toBeGreaterThanOrEqual(10);
    });

    it("не меньше пяти ролевых сцен, перед каждой — реплики собеседника без задания", () => {
      const all = blocks();
      expect(
        all.filter((block) => block.type === "speaking" && block.part === "roleplay").length,
      ).toBeGreaterThanOrEqual(5);
      all.forEach((block, i) => {
        if (block.type !== "speaking" || block.part !== "roleplay") return;
        const before = all[i - 1];
        expect(before?.type, block.id).toBe("listening");
        expect(
          all.some((other) => other.type === "exercise" && other.about === before?.id),
          block.id,
        ).toBe(false);
        expect(block.model, block.id).toBeTruthy();
        expect(block.criteria.length, block.id).toBeGreaterThan(0);
      });
    });

    it("каждое аудио точки звучит дважды", () => {
      for (const block of blocks()) if (block.type === "listening") expect(block.plays, block.id).toBe(2);
    });

    it("письмо рекрутеру — formal, 80–120 слов, образец и критерии; беседа по банку ответов", () => {
      const writing = blocks().filter((block) => block.type === "writing");
      expect(writing.length).toBeGreaterThanOrEqual(1);
      for (const block of writing) {
        expect(block.register, block.id).toBe("formal");
        expect(block.words, block.id).toEqual({ min: 80, max: 120 });
        expect(wordCount(block.model), block.id).toBeGreaterThanOrEqual(80);
        expect(wordCount(block.model), block.id).toBeLessThanOrEqual(120);
        expect(block.criteria.length, block.id).toBeGreaterThan(0);
      }
      const interview = blocks().flatMap((block) =>
        block.type === "speaking" && block.part === "interview" ? [block] : [],
      );
      expect(interview.length).toBeGreaterThanOrEqual(1);
      for (const block of interview) {
        expect(block.model, block.id).toBeTruthy();
        expect(block.criteria.length, block.id).toBeGreaterThan(0);
      }
    });

    it("говорящие — в карте голосов en и не из курса для путешествий", () => {
      const cast = content.sources.voices.get("en")!.characters;
      const speakers = blocks().flatMap((block) =>
        block.type === "listening" ? block.transcript.flatMap((line) => (line.speaker ? [line.speaker] : [])) : [],
      );
      expect(speakers.length).toBeGreaterThan(0);
      for (const speaker of new Set(speakers)) {
        expect(cast.has(speaker), speaker).toBe(true);
        expect(TRAVEL_NAMES.has(speaker), speaker).toBe(false);
      }
    });
  });
});
