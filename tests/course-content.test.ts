import "fake-indexeddb/auto";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCatalog, parsePackage } from "../src/content/schema";
import { courseFinished, moduleViews, nextStep } from "../src/storage/course";
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
  const STAGE = [
    "t01",
    "t02",
    "t03",
    "t04",
    "t05",
    "t06",
    "t07",
    "t15",
    "t08",
    "t09",
    "t10",
    "t11",
    "t12",
    "t13",
    "t14",
  ];
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
    t09: { register: "friendly", min: 40, max: 80 },
    t10: { register: "friendly", min: 20, max: 40 },
    t11: { register: "friendly", min: 60, max: 100 },
    t12: { register: "friendly", min: 60, max: 100 },
    t13: { register: "friendly", min: 40, max: 80 },
    t14: { register: "friendly", min: 60, max: 100 },
    t15: { register: "formal", min: 60, max: 100 },
  };
  const travel = () => catalog.courses.find((course) => course.id === "english-travel");
  const lessonOf = (id: string) => packagesOf("english-travel").find((pack) => pack.id === id);
  const blocksOf = (id: string) => lessonOf(id)!.blocks!;
  const cardIds = (prefix: string, moduleId: string) =>
    Array.from(
      { length: 15 },
      (_, i) => `${prefix}${String(15 * (Number(moduleId.slice(1)) - 1) + i + 1).padStart(3, "0")}`,
    );
  const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

  it("курс по программе: поля выбора, без календаря, 15 модулей, опубликованные модули", () => {
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
    expect(modules.map((m) => m.id)).toEqual(STAGE);
    expect(modules.map((m) => m.number)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const numberOf = (id: string) => modules.find((m) => m.id === id)!.number;
    expect(numberOf("t15")).toBe(8);
    expect(STAGE.slice(0, 7).map(numberOf)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(STAGE.slice(8).map(numberOf)).toEqual([9, 10, 11, 12, 13, 14, 15]);
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
      expect(words.map((word) => word.id).sort()).toEqual(cardIds("tw", moduleId));
      expect(phrases.map((phrase) => phrase.id).sort()).toEqual(cardIds("tp", moduleId));
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
      if (["t01", "t02", "t03", "t04"].includes(moduleId)) return;
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

  it("t12-2: блок безопасной первой встречи с тремя правилами программы", () => {
    const block = blocksOf("t12-2").find((item) => item.type === "explanation" && item.id === "safe-meeting");
    expect(block?.type).toBe("explanation");
    const body = block?.type === "explanation" ? block.body : "";
    expect(body).toMatch(/somewhere busy/);
    expect(body).toMatch(/my own way home/);
    expect(body).toMatch(/text a friend where I am/);
    const exercises = blocksOf("t12-2").filter((item) => item.type === "exercise" && item.id === "safe-q");
    expect(exercises).toHaveLength(1);
  });

  it("t13-test: оцениваемое задание к аудио, где после отказа собеседник принимает его без повторной просьбы", () => {
    const blocks = blocksOf("t13-test");
    const listening = blocks.find((item) => item.type === "listening" && item.id === "refusal");
    expect(listening?.type).toBe("listening");
    const lines = listening?.type === "listening" ? listening.transcript : [];
    const at = lines.findIndex((line) => /\bI'd rather not\b|\bno thanks\b|\bno,/i.test(line.text));
    expect(at).toBeGreaterThan(0);
    const asker = lines[at - 1].speaker;
    expect(lines[at - 1].text).toContain("?");
    expect(lines[at].speaker).not.toBe(asker);
    expect(lines[at + 1]?.speaker).toBe(asker);
    expect(lines[at + 1].text).toMatch(/no worries|fair enough|of course|totally fine|that's fine/i);
    const after = lines.slice(at + 1).filter((line) => line.speaker === asker);
    expect(after.filter((line) => line.text.includes("?"))).toHaveLength(0);
    const graded = blocks.filter(
      (item) => item.type === "exercise" && item.graded === true && item.about === "refusal",
    );
    expect(graded.length).toBeGreaterThan(0);
  });

  it("t15-1: блок о флагах и течении, спокойно и с оговоркой о странах", () => {
    const block = blocksOf("t15-1").find((item) => item.type === "explanation" && item.id === "water-safety");
    expect(block?.type).toBe("explanation");
    const body = block?.type === "explanation" ? block.body : "";
    expect(body).toMatch(/red and yellow/i);
    expect(body).toMatch(/red flag/i);
    expect(body).toMatch(/along the beach|parallel/i);
    expect(body).toMatch(/raise your arm|wave/i);
    expect(body).toMatch(/lifeguard/i);
    expect(body).toMatch(/RNLI/);
    expect(body).toMatch(/различа/);
    expect(body).toMatch(/\b112\b/);
    expect(body).toMatch(/\b999\b/);
    expect(body).not.toMatch(/!/);
    const exercises = blocksOf("t15-1").filter((item) => item.type === "exercise" && item.id === "water-safety-q");
    expect(exercises).toHaveLength(1);
  });

  it("t15: без контрольной точки, исходник урока до 60 000 байт, до 200 вариантов ответа на пункт", () => {
    expect(modulesOf("english-travel").find((m) => m.id === "t15")!.checkpointId).toBeUndefined();
    for (const id of ["t15-1", "t15-2", "t15-3", "t15-test"]) {
      expect(readFileSync(`content/lessons/${id}.yaml`).length, id).toBeLessThanOrEqual(60000);
      for (const block of blocksOf(id))
        if (block.type === "exercise" && block.format === "text")
          for (const item of block.items) expect(item.answer.length, `${id} ${item.id}`).toBeLessThanOrEqual(200);
    }
  });

  it("русские объяснения t15 без восклицательных знаков", () => {
    for (const id of ["t15-1", "t15-2", "t15-3", "t15-test"])
      for (const block of blocksOf(id))
        if (block.type === "explanation") expect(block.body, `${id} ${block.id}`).not.toMatch(/!/);
  });

  describe("карточки t15 и соседних модулей не встречаются в чужих текстах", () => {
    const SKIP_KEYS = new Set([
      "id",
      "type",
      "format",
      "about",
      "kind",
      "part",
      "register",
      "audio",
      "plays",
      "speaker",
    ]);
    const strings = (value: unknown): string[] =>
      typeof value === "string"
        ? [value]
        : Array.isArray(value)
          ? value.flatMap(strings)
          : value && typeof value === "object"
            ? Object.entries(value).flatMap(([key, item]) => (SKIP_KEYS.has(key) ? [] : strings(item)))
            : [];
    const stem = (card: string) =>
      card
        .replace(/[.?!]+$/, "")
        .replace(/^(a|an|the|to)\s+/i, "")
        .toLowerCase();
    const found = (stems: string[], texts: string[]) => {
      const hits: string[] = [];
      const haystack = texts.join("\n").toLowerCase();
      for (const word of new Set(stems))
        if (new RegExp(`(?<![\\w'-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:s|es)?(?![\\w'-])`).test(haystack))
          hits.push(word);
      return hits;
    };
    const hitsIn = (id: string, stems: string[], glossExempt: boolean) =>
      ((lessonOf(id)!.blocks ?? []) as Array<{ type: string; glosses?: Array<{ text: string }> }>)
        .flatMap((block) => {
          const hits = found(stems, strings(block));
          if (!glossExempt || block.type !== "reading") return hits;
          const glossed = (block.glosses ?? []).map((gloss) => gloss.text.toLowerCase());
          return hits.filter((hit) => !glossed.some((text) => text.includes(hit)));
        })
        .filter((hit) => !ALLOWED.some((item) => item.lesson === id && item.stem === hit));
    const cardsOf = (moduleIds: string[]) =>
      moduleIds
        .flatMap((id) => ["1", "2"].map((suffix) => lessonOf(`${id}-${suffix}`)!))
        .flatMap((pack) => [...pack.words.map((word) => word.greek), ...pack.phrases.map((phrase) => phrase.text)])
        .map(stem);
    const lessonsOf = (moduleIds: string[], extra: string[] = []) => [
      ...moduleIds.flatMap((id) => ["1", "2", "3", "test"].map((suffix) => `${id}-${suffix}`)),
      ...extra,
    ];
    const LATER = ["t08", "t09", "t10", "t11", "t12", "t13", "t14"];
    const EARLIER = ["t01", "t02", "t03", "t04", "t05", "t06", "t07"];
    const ALLOWED: Array<{ lesson: string; stem: string; reason: string }> = ["t15-1", "t15-test"].map((lesson) => ({
      lesson,
      stem: "red flag",
      reason: "флаг на пляже, а не тревожный признак",
    }));

    it("карточки t08–t14 не используются в текстах t15 вне глосс чтения", () => {
      const cards = cardsOf(LATER);
      for (const id of lessonsOf(["t15"])) expect(hitsIn(id, cards, true), id).toEqual([]);
    });
    it("карточки t15 не используются в текстах t01–t07, «Дня поездки» и t08–t14", () => {
      const cards = cardsOf(["t15"]);
      for (const id of lessonsOf([...EARLIER, ...LATER], ["t07-c1", "t14-c2"]))
        expect(hitsIn(id, cards, false), id).toEqual([]);
    });
  });

  describe("порядок полки и следующий шаг", () => {
    const lessonsOfModule = (id: string) => ["1", "2", "3", "test"].map((suffix) => `${id}-${suffix}`);
    const all = [...STAGE.flatMap(lessonsOfModule), "t07-c1", "t14-c2"];
    let db: AppDatabase;
    beforeEach(async () => {
      await new AppDatabase("tetradio-travel-shelf").delete();
      db = new AppDatabase("tetradio-travel-shelf");
      await installLessons(db, all, memoryFetcher(content));
    });
    afterEach(() => db.close());
    const views = () => moduleViews("english-travel", db);
    const step = async () => nextStep(await views());
    const done = (modules: string[], extra: string[] = []) =>
      completeLessons(db, [...modules.flatMap(lessonsOfModule), ...extra]);

    it("полка идёт по номерам: t07, t15, t08", async () => {
      expect((await views()).map((view) => view.module.id)).toEqual(STAGE);
    });
    it("t01–t07 пройдены без точки — следующий шаг «День поездки»", async () => {
      await done(STAGE.slice(0, 7));
      expect((await step())!.lesson.id).toBe("t07-c1");
    });
    it("t01–t07 и «День поездки» пройдены — следующий шаг t15-1", async () => {
      await done(STAGE.slice(0, 7), ["t07-c1"]);
      expect((await step())!.lesson.id).toBe("t15-1");
    });
    it("пройдены t15 и t08–t09 — следующий шаг t10-1", async () => {
      await done([...STAGE.slice(0, 8), "t08", "t09"], ["t07-c1"]);
      expect((await step())!.lesson.id).toBe("t10-1");
    });
    it("пройдены t08–t14, но не t15 — следующий шаг t15-1", async () => {
      await done([...STAGE.slice(0, 7), ...STAGE.slice(8)], ["t07-c1"]);
      expect((await step())!.lesson.id).toBe("t15-1");
    });
    it("пройдено всё, кроме t15: курс не пройден, после t15 — пройден", async () => {
      await done([...STAGE.slice(0, 7), ...STAGE.slice(8)], ["t07-c1", "t14-c2"]);
      expect(courseFinished(await views(), await step())).toBe(false);
      expect((await step())!.lesson.id).toBe("t15-1");
      await done(["t15"]);
      expect(courseFinished(await views(), await step())).toBe(true);
    });
    it("прогресс хранится по урокам, а не по номеру модуля", async () => {
      await done(["t08", "t09", "t10"]);
      const rows = await db.lessons.filter((lesson) => lesson.completed).toArray();
      expect(rows.map((row) => row.id).sort()).toEqual(["t08", "t09", "t10"].flatMap(lessonsOfModule).sort());
      expect((await views()).filter((view) => view.completed).map((view) => view.module.number)).toEqual([9, 10, 11]);
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

  describe("контрольная точка «Вечер»", () => {
    const blocks = () => blocksOf("t14-c2");
    const stageLessons = STAGE.flatMap((moduleId) => ["1", "2", "3", "test"].map((suffix) => `${moduleId}-${suffix}`));
    let db: AppDatabase;
    beforeEach(async () => {
      await new AppDatabase("tetradio-travel-evening").delete();
      db = new AppDatabase("tetradio-travel-evening");
      await installLessons(db, [...stageLessons, "t07-c1", "t14-c2"], memoryFetcher(content));
    });
    afterEach(() => db.close());
    const step = async () => nextStep(await moduleViews("english-travel", db));
    const kindOf = (id?: string) => blocks().find((block) => block.id === id)?.type;
    const itemsOf = (skill: string) =>
      blocks()
        .filter((block) => block.type === "exercise" && block.graded && kindOf(block.about) === skill)
        .reduce((sum, block) => sum + (block.type === "exercise" ? block.items.length : 0), 0);

    it("уроки t01–t14 и «День поездки» пройдены — следующий шаг «Вечер»", async () => {
      await completeLessons(db, [...stageLessons, "t07-c1"]);
      expect((await step())!.lesson).toMatchObject({ id: "t14-c2", title: "Вечер", kind: "test" });
    });
    it("без «Дня поездки» следующий шаг он, а не «Вечер»", async () => {
      await completeLessons(db, stageLessons);
      expect((await step())!.lesson.id).toBe("t07-c1");
    });
    it("контрольная t10-test не пройдена — следующий шаг она, а не «Вечер»", async () => {
      await completeLessons(db, [...stageLessons.filter((id) => id !== "t10-test"), "t07-c1"]);
      expect((await step())!.lesson.id).toBe("t10-test");
    });

    it("стоит после t14, контрольная без карточек с заголовком без «C2» и «CEFR»", () => {
      expect(modulesOf("english-travel").find((m) => m.id === "t14")!.checkpointId).toBe("t14-c2");
      const pack = lessonOf("t14-c2")!;
      expect(pack.lesson.kind).toBe("test");
      expect(pack.lesson.title).toBe("Вечер");
      expect(pack.lesson.title).not.toMatch(/C2|CEFR/i);
      expect(pack.items).toEqual([]);
      expect(pack.words).toEqual([]);
      expect(pack.phrases).toEqual([]);
    });
    it("чтение и аудирование — не меньше 10 оцениваемых пунктов на навык", () => {
      expect(itemsOf("reading")).toBeGreaterThanOrEqual(10);
      expect(itemsOf("listening")).toBeGreaterThanOrEqual(10);
    });
    it("не меньше пяти ролевых сцен, перед каждой — реплики собеседника без задания", () => {
      const all = blocks();
      const scenes = all.filter((block) => block.type === "speaking" && block.part === "roleplay");
      expect(scenes.length).toBeGreaterThanOrEqual(5);
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
    it("беседа по банку ответов с образцом и критериями", () => {
      const interviews = blocks().flatMap((block) =>
        block.type === "speaking" && block.part === "interview" ? [block] : [],
      );
      expect(interviews).toHaveLength(1);
      for (const block of interviews) {
        expect(block.model).toBeTruthy();
        expect(block.criteria.length).toBeGreaterThan(0);
      }
    });
    it("письмо дружеское, 60–100 слов, с образцом и критериями", () => {
      const writing = blocks().filter((block) => block.type === "writing");
      expect(writing).toHaveLength(1);
      for (const block of writing) {
        expect(block.register).toBe("friendly");
        expect(block.words).toEqual({ min: 60, max: 100 });
        expect(wordCount(block.model), block.id).toBeGreaterThanOrEqual(60);
        expect(wordCount(block.model), block.id).toBeLessThanOrEqual(100);
        expect(block.criteria.length, block.id).toBeGreaterThan(0);
      }
    });
    it("сцены отказа: собеседник принимает отказ без повторной просьбы", () => {
      const transcriptOf = (id: string) => {
        const block = blocks().find((item) => item.type === "listening" && item.id === id);
        return block?.type === "listening" ? block.transcript : [];
      };
      const answer = transcriptOf("answer-lines");
      expect(answer.length).toBeGreaterThan(0);
      expect(answer.every((line) => line.speaker === "Isla")).toBe(true);
      expect(answer.some((line) => /don't think we're a match/.test(line.text))).toBe(true);
      expect(answer.filter((line) => line.text.includes("?"))).toEqual([]);
      const no = transcriptOf("no-lines");
      expect(no.length).toBeGreaterThan(3);
      expect(no.every((line) => line.speaker === "Noah")).toBe(true);
      expect(no.slice(-2).filter((line) => line.text.includes("?"))).toEqual([]);
      expect(no.at(-2)?.text).toMatch(/thanks for telling me/i);
    });
    it("в точке нет персонажей Lena и Will из t13", () => {
      expect(JSON.stringify(blocks())).not.toMatch(/\bLena\b|\bWill\b(?! do)/);
    });
    it("говорящие — в карте голосов en и не из IT-курса, голоса в диалоге разные", () => {
      const cast = content.sources.voices.get("en")!.characters;
      const dialogues = blocks().flatMap((block) => (block.type === "listening" ? [block.transcript] : []));
      for (const transcript of dialogues) {
        const speakers = new Set(transcript.flatMap((line) => (line.speaker ? [line.speaker] : [])));
        for (const speaker of speakers) {
          expect(cast.has(speaker), speaker).toBe(true);
          expect(IT_NAMES.has(speaker), speaker).toBe(false);
        }
        const voices = [...speakers].map((speaker) => cast.get(speaker)!.voice);
        expect(new Set(voices).size).toBe(voices.length);
      }
    });
  });
});
