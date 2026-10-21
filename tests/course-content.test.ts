import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalog, parsePackage } from "../src/content/schema";
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
  it("контента Tavelori в продукте нет", () => {
    expect(content.words.some((word) => /^w\d{2}-\d{2}$/.test(word.id))).toBe(false);
    expect(catalog.courses.map((c) => c.id)).toEqual(["greek-a2", "english-it", "english-travel"]);
  });
  it("английский для IT: 16 модулей программы без календаря, опубликованы модули с первого", () => {
    const english = catalog.courses.find((course) => course.id === "english-it")!;
    expect(english).toMatchObject({ title: "Английский для IT", language: "en" });
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
  const travel = () => catalog.courses.find((course) => course.id === "english-travel");
  const lessonOf = (id: string) => packagesOf("english-travel").find((pack) => pack.id === id);
  it("курс по программе: поля выбора, без календаря, 14 модулей, t01 опубликован частично двумя уроками", () => {
    expect(travel()).toMatchObject({
      title: "Английский для путешествий и общения",
      language: "en",
      level: "B1 → B1+",
      goal: "Поездка и разговор с новыми людьми на английском",
      short: "Путешествия",
      order: 3,
      passShare: 0.6,
    });
    expect(travel()).not.toHaveProperty("calendar");
    const modules = modulesOf("english-travel");
    expect(modules.map((m) => m.id)).toEqual(
      Array.from({ length: 14 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`),
    );
    expect(modules.map((m) => m.number)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(modules[0]).toMatchObject({ status: "published", lessonIds: ["t01-1", "t01-2"] });
    for (const module of modules.slice(1)) expect(module.status, module.id).toBe("draft");
    expect(content.partial).toEqual([expect.objectContaining({ id: "t01" })]);
    for (const [id, module] of content.sources.modules)
      if (/^m\d+$/.test(id)) expect(module.partial, id).toBeUndefined();
  });
  it("карточки t01: 15 слов tw… и 15 фраз tp…, каждая в одном уроке, у фраз перевод и происхождение", () => {
    const packs = ["t01-1", "t01-2"].map((id) => lessonOf(id)!);
    const words = packs.flatMap((pack) => pack.words);
    const phrases = packs.flatMap((pack) => pack.phrases);
    expect(words.map((word) => word.id).sort()).toEqual(
      Array.from({ length: 15 }, (_, i) => `tw${String(i + 1).padStart(3, "0")}`),
    );
    expect(phrases.map((p) => p.id).sort()).toEqual(
      Array.from({ length: 15 }, (_, i) => `tp${String(i + 1).padStart(3, "0")}`),
    );
    for (const word of words) expect(word.ipa, word.greek).toMatch(/^\/.+\/$/);
    for (const phrase of phrases) {
      expect(phrase.translation, phrase.text).toBeTruthy();
      expect(content.sources.phrases.get(phrase.id)!.provenance).toMatchObject({ operation: "requested-generation" });
    }
  });
  it("уроки t01: грамматика с лексикой и заданиями; чтение и два аудирования с заданиями; новые персонажи", () => {
    const first = lessonOf("t01-1")!.blocks!;
    expect(first.some((block) => block.type === "explanation" && block.table)).toBe(true);
    expect(first.some((block) => block.type === "vocabulary")).toBe(true);
    expect(first.filter((block) => block.type === "exercise").length).toBeGreaterThanOrEqual(4);
    const second = lessonOf("t01-2")!.blocks!;
    const about = (id: string) => second.some((block) => block.type === "exercise" && block.about === id);
    const readings = second.filter((block) => block.type === "reading");
    const listenings = second.filter((block) => block.type === "listening");
    expect(readings.length).toBeGreaterThanOrEqual(1);
    expect(listenings).toHaveLength(2);
    for (const block of [...readings, ...listenings]) expect(about(block.id), block.id).toBe(true);
    for (const block of listenings) if (block.type === "listening") expect(block.plays).toBe(2);
    const speakers = new Set(
      listenings.flatMap((block) => (block.type === "listening" ? block.transcript.map((line) => line.speaker) : [])),
    );
    speakers.delete(undefined);
    expect(speakers.size).toBeGreaterThanOrEqual(2);
    for (const name of ["Sarah", "Daniel", "Mark", "Elena"]) expect(speakers.has(name), name).toBe(false);
    const cast = content.sources.voices.get("en")!.characters;
    for (const speaker of speakers) expect(cast.has(speaker!), speaker).toBe(true);
  });
});
