import "fake-indexeddb/auto";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCatalog, parsePackage } from "../src/content/schema";
import { moduleViews, nextStep } from "../src/storage/course";
import { AppDatabase } from "../src/storage/db";
import { completeLessons, installLessons, memoryFetcher } from "./helpers/content";
import { GREEK_CALENDAR } from "./helpers/calendar";
import { realContent } from "./helpers/real-content";

/** Настоящий курс из content/: собирается, модули по программе, опубликованы только проверенные. */
const content = realContent();
const catalog = parseCatalog(JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string));
const greek = catalog.courses.find((course) => course.id === "greek-a2")!;
const modulesOf = (courseId: string) => catalog.modules!.filter((module) => module.courseId === courseId);
const packagesOf = (courseId: string) => content.packages.filter((pack) => pack.courseId === courseId);

describe("курс в продукте", () => {
  it("24 модуля программы по порядку; опубликованные — с уроками и контрольной, остальные — черновики", () => {
    expect(modulesOf("greek-a2").map((m) => m.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    const published = modulesOf("greek-a2").filter((m) => m.status === "published");
    expect(published[0]?.id).toBe("m01");
    for (const module of published) {
      const lessons = module.lessonIds.map((id) => content.packages.find((pack) => pack.id === id)!);
      expect(lessons.map((pack) => pack.lesson.kind).at(-1), module.id).toBe("test");
      expect(lessons.length, module.id).toBe(module.sessions + 1);
    }
  });
  it("пакеты проходят клиентскую проверку, у каждого слова есть IPA, все карточки в уроках", () => {
    for (const pack of content.packages) expect(() => parsePackage(JSON.parse(JSON.stringify(pack)))).not.toThrow();
    expect(content.words.length).toBeGreaterThanOrEqual(35);
    for (const word of content.words) expect(word.ipa, word.greek).toMatch(/^\/.+\/$/);
  });
  it("карточки носят короткие идентификаторы из лексикона с тем же написанием", () => {
    const lexicon = new Map(
      readdirSync("docs/course/lexicon")
        .filter((file) => /^\d{2}\.tsv$/.test(file))
        .flatMap((file) => readFileSync(`docs/course/lexicon/${file}`, "utf8").trim().split("\n").slice(1))
        .map((line) => line.split("\t"))
        .map(([id, greek]) => [id, greek]),
    );
    for (const word of packagesOf("greek-a2").flatMap((pack) => pack.words)) {
      expect(word.id).toMatch(/^w\d{3,}$/);
      expect(lexicon.get(word.id), word.id).toBe(word.greek);
    }
    for (const phrase of packagesOf("greek-a2").flatMap((pack) => pack.phrases)) {
      expect(phrase.id).toMatch(/^p\d{3,}$/);
      expect(lexicon.get(phrase.id), phrase.id).toBe(phrase.text);
    }
  });
  it("экзамен: общая дата с источником, местная дата не подтверждена", () => {
    expect(greek.exam).toMatchObject({ date: "2027-05-11", localConfirmed: false });
    expect(greek.exam!.source).toMatch(/^https:\/\/www\.greek-language\.gr\//);
  });
  it("календарь и порог навыка — данные курса, прежние значения", () => {
    expect(greek.calendar).toEqual(GREEK_CALENDAR);
    expect(greek.passShare).toBe(0.6);
    expect(greek.exam).not.toHaveProperty("passShare");
  });
  it("греческий называется в языке «Греческий» и рисуется гаммой по умолчанию", () => {
    expect(greek.short).toBe("Греческий");
    expect(greek).not.toHaveProperty("palette");
  });
  it("контента Tavelori в продукте нет", () => {
    expect(content.words.some((word) => /^w\d{2}-\d{2}$/.test(word.id))).toBe(false);
    expect(catalog.courses.map((c) => c.id)).toEqual(["greek-a2", "english-it", "english-travel"]);
  });
  it("английский для IT: 16 модулей программы без календаря, опубликованы модули с первого", () => {
    const english = catalog.courses.find((course) => course.id === "english-it")!;
    expect(english).toMatchObject({ title: "Английский для IT", language: "en", short: "Для IT", palette: "ink" });
    expect(english).not.toHaveProperty("calendar");
    expect(modulesOf("english-it").map((m) => m.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    // Опубликованные модули идут подряд с первого: новый английский модуль тест не ломает.
    const published = modulesOf("english-it")
      .filter((m) => m.status === "published")
      .map((m) => m.number);
    expect(published.length).toBeGreaterThan(0);
    expect(published).toEqual(Array.from({ length: published.length }, (_, i) => i + 1));
  });
  it("карточки английского курса — ew… и ep…", () => {
    const packs = packagesOf("english-it");
    for (const word of packs.flatMap((pack) => pack.words)) expect(word.id).toMatch(/^ew\d{3,}$/);
    for (const phrase of packs.flatMap((pack) => pack.phrases)) expect(phrase.id).toMatch(/^ep\d{3,}$/);
  });
});

describe("английский для путешествий и общения", () => {
  const STAGE = ["t01", "t02", "t03", "t04", "t05", "t06", "t07", "t08"];
  const TRIP = STAGE.slice(0, 7);
  const RUDE =
    /\b(fuck\w*|shit\w*|bitch\w*|bastard\w*|arse(hole|s)?|wank\w*|piss\w*|twat\w*|cunt\w*|prick(s)?|slut\w*|whore\w*|bollocks|crap\w*|dick\w*|\bass(hole)?\b)\b/i;
  const IT_NAMES = new Set(
    packagesOf("english-it")
      .flatMap((pack) => pack.blocks ?? [])
      .flatMap((block) => (block.type === "listening" ? block.transcript.map((line) => line.speaker) : [])),
  );
  const WRITING: Record<string, { register: string; min: number; max: number }> = {
    t01: { register: "formal", min: 20, max: 40 },
    t02: { register: "friendly", min: 20, max: 40 },
    t03: { register: "friendly", min: 60, max: 100 },
    t04: { register: "formal", min: 60, max: 100 },
    t05: { register: "formal", min: 60, max: 100 },
    t06: { register: "formal", min: 60, max: 100 },
    t07: { register: "formal", min: 80, max: 100 },
    t08: { register: "friendly", min: 20, max: 40 },
  };
  const travel = () => catalog.courses.find((course) => course.id === "english-travel");
  const lessonOf = (id: string) => packagesOf("english-travel").find((pack) => pack.id === id);
  const blocksOf = (id: string) => lessonOf(id)!.blocks!;
  const cardIds = (prefix: string, number: number) =>
    Array.from({ length: 15 }, (_, i) => `${prefix}${String(15 * (number - 1) + i + 1).padStart(3, "0")}`);
  const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

  it("курс по программе: поля выбора, без календаря, 14 модулей, опубликованные модули", () => {
    expect(travel()).toMatchObject({
      title: "Английский для путешествий и общения",
      language: "en",
      level: "B1 → B1+",
      goal: "Поездка и разговор с новыми людьми на английском",
      short: "Для путешествий",
      palette: "coast",
      order: 3,
      passShare: 0.6,
    });
    expect(travel()).not.toHaveProperty("calendar");
    const modules = modulesOf("english-travel");
    expect(modules.map((m) => m.id)).toEqual(
      Array.from({ length: 14 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`),
    );
    expect(modules.map((m) => m.number)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    for (const module of modules.filter((m) => !STAGE.includes(m.id))) expect(module.status, module.id).toBe("draft");
    expect(content.partial).toEqual([]);
  });

  it("в карточках курса нет грубого и бранного сленга", () => {
    const cards = packagesOf("english-travel").flatMap((pack) => [
      ...pack.words.map((word) => `${word.greek} ${word.russian}`),
      ...pack.phrases.map((phrase) => `${phrase.text} ${phrase.translation ?? ""}`),
    ]);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card, card).not.toMatch(RUDE);
  });

  describe.each(STAGE)("модуль %s", (moduleId) => {
    const module = () => modulesOf("english-travel").find((m) => m.id === moduleId)!;
    const lessonIds = ["1", "2", "3", "test"].map((suffix) => `${moduleId}-${suffix}`);
    const [first, second, third, test] = lessonIds;

    it("опубликован полностью: три урока и контрольная, шпаргалка", () => {
      expect(module()).toMatchObject({ status: "published", lessonIds });
      expect(module().crib, moduleId).toBeDefined();
      expect(lessonOf(test)!.lesson.kind).toBe("test");
    });
    it("15 слов и 15 фраз модуля — только в двух первых уроках, каждая в одном; IPA, перевод, происхождение", () => {
      const packs = [first, second].map((id) => lessonOf(id)!);
      const words = packs.flatMap((pack) => pack.words);
      const phrases = packs.flatMap((pack) => pack.phrases);
      expect(words.map((word) => word.id).sort()).toEqual(cardIds("tw", module().number));
      expect(phrases.map((phrase) => phrase.id).sort()).toEqual(cardIds("tp", module().number));
      for (const id of [third, test]) {
        expect(lessonOf(id)!.words, id).toEqual([]);
        expect(lessonOf(id)!.phrases, id).toEqual([]);
      }
      for (const word of words) expect(word.ipa, word.greek).toMatch(/^\/.+\/$/);
      for (const phrase of phrases) {
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
    it("третий урок: письмо в границах программы с образцом и критериями, не меньше двух устных заданий", () => {
      const blocks = blocksOf(third);
      const expected = WRITING[moduleId]!;
      const writing = blocks.filter((block) => block.type === "writing");
      expect(writing.length).toBeGreaterThanOrEqual(1);
      for (const block of writing) {
        expect(block.register, block.id).toBe(expected.register);
        expect(block.words.min, block.id).toBeGreaterThanOrEqual(expected.min);
        expect(block.words.max, block.id).toBeLessThanOrEqual(expected.max);
        expect(wordCount(block.model), block.id).toBeGreaterThanOrEqual(block.words.min);
        expect(wordCount(block.model), block.id).toBeLessThanOrEqual(block.words.max);
        expect(block.criteria.length, block.id).toBeGreaterThan(0);
      }
      const speaking = blocks.filter((block) => block.type === "speaking");
      expect(speaking.length).toBeGreaterThanOrEqual(2);
      for (const block of speaking) {
        expect(block.model, block.id).toBeTruthy();
        expect(block.criteria.length, block.id).toBeGreaterThan(0);
      }
      if (module().number < 5) return;
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
    });
    it("контрольная: оцениваемые задания к чтению и к аудированию", () => {
      const blocks = blocksOf(test);
      const kindOf = (id?: string) => blocks.find((block) => block.id === id)?.type;
      const graded = blocks.filter((block) => block.type === "exercise" && block.graded);
      const skills = new Set(graded.map((block) => (block.type === "exercise" ? kindOf(block.about) : undefined)));
      expect(skills.has("reading")).toBe(true);
      expect(skills.has("listening")).toBe(true);
    });
    it("говорящие — в карте голосов en и не из IT-курса", () => {
      const cast = content.sources.voices.get("en")!.characters;
      const speakers = new Set(
        lessonIds
          .flatMap((id) => blocksOf(id))
          .flatMap((block) => (block.type === "listening" ? block.transcript.map((line) => line.speaker) : [])),
      );
      speakers.delete(undefined);
      for (const speaker of speakers) {
        expect(cast.has(speaker!), speaker).toBe(true);
        expect(IT_NAMES.has(speaker), speaker).toBe(false);
      }
    });
  });

  describe("контрольная точка «День поездки»", () => {
    const blocks = () => blocksOf("t07-c1");
    const stageLessons = TRIP.flatMap((moduleId) => ["1", "2", "3", "test"].map((suffix) => `${moduleId}-${suffix}`));
    let db: AppDatabase;
    beforeEach(async () => {
      await new AppDatabase("tetradio-travel-checkpoint").delete();
      db = new AppDatabase("tetradio-travel-checkpoint");
      await installLessons(db, [...stageLessons, "t07-c1"], memoryFetcher(content));
    });
    afterEach(() => db.close());
    const step = async () => nextStep(await moduleViews("english-travel", db));

    it("уроки t01–t07 пройдены — следующий шаг курса «День поездки»", async () => {
      await completeLessons(db, stageLessons);
      expect((await step())!.lesson).toMatchObject({ id: "t07-c1", title: "День поездки", kind: "test" });
    });
    it("контрольная t03-test не пройдена — следующий шаг она, а не точка", async () => {
      await completeLessons(
        db,
        stageLessons.filter((id) => id !== "t03-test"),
      );
      expect((await step())!.lesson.id).toBe("t03-test");
    });

    it("стоит после t07, контрольная без карточек с заголовком без «C1»", () => {
      expect(modulesOf("english-travel").find((m) => m.id === "t07")!.checkpointId).toBe("t07-c1");
      const pack = lessonOf("t07-c1")!;
      expect(pack.lesson.kind).toBe("test");
      expect(pack.lesson.title).toBe("День поездки");
      expect(pack.lesson.title).not.toMatch(/C1/);
      expect(pack.words).toEqual([]);
      expect(pack.phrases).toEqual([]);
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
    it("пять ролевых сцен, перед каждой — реплики собеседника без задания", () => {
      const all = blocks();
      const scenes = all.filter((block) => block.type === "speaking" && block.part === "roleplay");
      expect(scenes.length).toBe(5);
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
    it("два письма: хосту дружески и формальная жалоба, с образцом и критериями", () => {
      const writing = blocks().filter((block) => block.type === "writing");
      expect(writing.map((block) => block.register).sort()).toEqual(["formal", "friendly"]);
      for (const block of writing) {
        expect(wordCount(block.model), block.id).toBeGreaterThanOrEqual(block.words.min);
        expect(wordCount(block.model), block.id).toBeLessThanOrEqual(block.words.max);
        expect(block.criteria.length, block.id).toBeGreaterThan(0);
      }
    });
    it("говорящие — в карте голосов en и не из IT-курса", () => {
      const cast = content.sources.voices.get("en")!.characters;
      const speakers = blocks().flatMap((block) =>
        block.type === "listening" ? block.transcript.flatMap((line) => (line.speaker ? [line.speaker] : [])) : [],
      );
      expect(IT_NAMES).toContain("Elena");
      for (const speaker of new Set(speakers)) {
        expect(cast.has(speaker), speaker).toBe(true);
        expect(IT_NAMES.has(speaker), speaker).toBe(false);
      }
    });
  });
});
