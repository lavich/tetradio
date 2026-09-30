import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { parseCatalog, parsePackage } from "../src/content/schema";

/** Настоящий курс из content/: собирается, модули по программе, опубликованы только проверенные. */
const content = buildContent("content");
const catalog = parseCatalog(JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string));

describe("курс в продукте", () => {
  it("24 модуля программы по порядку; опубликован модуль 01, остальные — черновики", () => {
    expect(catalog.modules!.map((m) => m.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(catalog.modules!.filter((m) => m.status === "published").map((m) => m.id)).toEqual(["m01"]);
    expect(catalog.modules![0].lessonIds).toEqual(["m01-1", "m01-2", "m01-3", "m01-test"]);
  });
  it("пакеты модуля 01 проходят клиентскую проверку, у каждого слова есть формы или IPA", () => {
    for (const pack of content.packages) expect(() => parsePackage(JSON.parse(JSON.stringify(pack)))).not.toThrow();
    expect(content.words).toHaveLength(35);
    expect(content.phrases).toHaveLength(14);
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
  it("контента Tavelori в продукте нет", () => {
    expect(content.words.some((word) => /^w\d{2}-\d{2}$/.test(word.id))).toBe(false);
    expect(catalog.courses.map((c) => c.id)).toEqual(["greek-a2"]);
  });
});
