import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { parseCatalog, parsePackage } from "../src/content/schema";

/** Настоящий курс из content/: собирается, модули по программе, опубликованы только проверенные. */
const content = buildContent("content");
const catalog = parseCatalog(JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string));

describe("курс в продукте", () => {
  it("24 модуля программы по порядку; опубликованные — с уроками и контрольной, остальные — черновики", () => {
    expect(catalog.modules!.map((m) => m.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    const published = catalog.modules!.filter((m) => m.status === "published");
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
    for (const word of content.words) {
      expect(word.id).toMatch(/^w\d{3,}$/);
      expect(lexicon.get(word.id), word.id).toBe(word.greek);
    }
    for (const phrase of content.phrases) {
      expect(phrase.id).toMatch(/^p\d{3,}$/);
      expect(lexicon.get(phrase.id), phrase.id).toBe(phrase.text);
    }
  });
  it("экзамен: общая дата с источником, местная дата не подтверждена", () => {
    expect(catalog.courses[0].exam).toMatchObject({ date: "2027-05-11", localConfirmed: false });
    expect(catalog.courses[0].exam!.source).toMatch(/^https:\/\/www\.greek-language\.gr\//);
  });
  it("контента Tavelori в продукте нет", () => {
    expect(content.words.some((word) => /^w\d{2}-\d{2}$/.test(word.id))).toBe(false);
    expect(catalog.courses.map((c) => c.id)).toEqual(["greek-a2"]);
  });
});
