import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { parseCatalog, parsePackage } from "../src/content/schema";
import { GREEK_CALENDAR } from "./helpers/calendar";

/** Настоящий курс из content/: собирается, модули по программе, опубликованы только проверенные. */
const content = buildContent("content");
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
    expect(catalog.courses.map((c) => c.id)).toEqual(["english-it", "greek-a2"]);
  });
  it("английский для IT: 16 модулей программы без календаря, опубликован e01", () => {
    const english = catalog.courses.find((course) => course.id === "english-it")!;
    expect(english).toMatchObject({ title: "Английский для IT", language: "en" });
    expect(english).not.toHaveProperty("calendar");
    expect(modulesOf("english-it").map((m) => m.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(
      modulesOf("english-it")
        .filter((m) => m.status === "published")
        .map((m) => m.id),
    ).toEqual(["e01"]);
  });
  it("карточки английского курса — ew… и ep…", () => {
    const packs = packagesOf("english-it");
    for (const word of packs.flatMap((pack) => pack.words)) expect(word.id).toMatch(/^ew\d{3,}$/);
    for (const phrase of packs.flatMap((pack) => pack.phrases)) expect(phrase.id).toMatch(/^ep\d{3,}$/);
  });
});
