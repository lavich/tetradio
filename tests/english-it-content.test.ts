import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { wordCount } from "../src/domain/course";
import { parseCatalog } from "../src/content/schema";
import { realContent } from "./helpers/real-content";

const content = realContent();
const catalog = parseCatalog(JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string));
const modulesOf = (courseId: string) => catalog.modules!.filter((module) => module.courseId === courseId);
const packagesOf = (courseId: string) => content.packages.filter((pack) => pack.courseId === courseId);

describe("английский для IT: ступень B1+", () => {
  const STAGE = ["e01", "e02", "e03", "e04", "e05"];
  const WRITING: Record<string, { register: string; min: number; max: number }> = {
    e01: { register: "formal", min: 60, max: 90 },
    e02: { register: "formal", min: 60, max: 90 },
    e03: { register: "formal", min: 60, max: 100 },
    e04: { register: "formal", min: 60, max: 100 },
    e05: { register: "formal", min: 80, max: 120 },
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
        for (const block of speaking) expect(block.seconds, block.id).toBeLessThanOrEqual(120);
        expect(speaking.some((block) => block.seconds >= 60)).toBe(true);
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
});
