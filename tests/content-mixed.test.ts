import { describe, expect, it } from "vitest";
import { buildContent, phraseRevisionOf, type BuiltContent } from "../content/build";
import { parseCatalog, parsePackage } from "../src/content/schema";
import { buildMixed, type MixedFiles } from "./helpers/mixed";

/**
 * Непубликуемая фикстура: смешанный урок собирается во временной копии исходников проекта (см. helpers/mixed.ts).
 * Реальный каталог фраз её не получает; тексты — иллюстрация формата на уже существующем примере проекта.
 */
const provenance = {
  sourceLabel: "Существующий пример проекта, иллюстрация формата",
  locator: "content/words/γράφω.yaml, examples[0]",
  excerpt: "Γράφω ένα γράμμα.",
  operation: "verbatim",
};
const phrase = {
  text: "Γράφω ένα γράμμα.",
  translation: "Я пишу письмо.",
  provenance,
};
const second = {
  text: "Το βουνό είναι ψηλό.",
  translation: "Гора высокая.",
  provenance: { ...provenance, locator: "content/words/το-βουνό.yaml, examples[0]", excerpt: "Το βουνό είναι ψηλό." },
};
const mixed = ({ phrases = { "p-grafo": phrase }, lesson, mutate }: MixedFiles = {}) =>
  buildMixed({
    phrases,
    lesson: lesson ?? {
      title: "Смешанный урок",
      language: "el",
      items: [...Object.keys(phrases).map((id) => ({ kind: "phrase", id })), { kind: "word", id: "w11-27" }],
    },
    mutate,
  });
const pack = (built: BuiltContent) => built.packages.find((p) => p.id === "lesson-mixed")!;

describe("сборка смешанного урока", () => {
  it("собирает фразы и слова в авторском порядке и проходит проверку пакета", () => {
    const built = mixed({ phrases: { "p-grafo": phrase, "p-vouno": second } });
    const mixedPack = pack(built);
    expect(mixedPack.schemaVersion).toBe(3);
    expect(mixedPack.items.map((item) => [item.kind, item.id, item.position])).toEqual([
      ["phrase", "p-grafo", 0],
      ["phrase", "p-vouno", 1],
      ["word", "w11-27", 2],
    ]);
    expect(mixedPack.phrases[0]).toMatchObject({
      id: "p-grafo",
      text: "Γράφω ένα γράμμα.",
      translation: "Я пишу письмо.",
    });
    expect(mixedPack.words.map((word) => word.id)).toEqual(["w11-27"]);
    const file = built.files.find((f) => f.path === built.catalog.lessons.find((l) => l.id === "lesson-mixed")!.url)!;
    expect(parsePackage(JSON.parse(file.body as string)).items).toHaveLength(3);
    const entry = parseCatalog(
      JSON.parse(built.files.find((f) => f.path === "content/catalog.json")!.body as string),
    ).lessons.find((l) => l.id === "lesson-mixed")!;
    expect(entry).toMatchObject({ wordCount: 1, phraseCount: 2, cardCount: 3 });
  });
  it("урок без слов допустим, прежний список words принимается как сокращение", () => {
    const built = mixed({
      phrases: { "p-grafo": phrase, "p-vouno": second },
      lesson: {
        title: "Без слов",
        items: [
          { kind: "phrase", id: "p-grafo" },
          { kind: "phrase", id: "p-vouno" },
        ],
      },
    });
    expect(pack(built).words).toEqual([]);
    expect(pack(built).items).toHaveLength(2);
    // Уроки, объявленные списком words, дают только слова — независимо от того, какие уроки смешанные.
    for (const p of built.packages.filter((p) => built.sources.lessons.get(p.id)?.words))
      expect(
        p.items.every((item) => item.kind === "word"),
        p.id,
      ).toBe(true);
    expect(() =>
      mixed({ lesson: { title: "Оба", words: ["w11-27"], items: [{ kind: "phrase", id: "p-grafo" }] } }),
    ).toThrow(/либо words, либо items/);
    expect(() => mixed({ lesson: { title: "Пусто" } })).toThrow(/нужен непустой список/);
  });
  it("ревизия фразы меняется от текста и перевода, идентификатор — нет", () => {
    const base = pack(mixed()).phrases[0];
    const retranslated = pack(mixed({ phrases: { "p-grafo": { ...phrase, translation: "Другой перевод" } } }))
      .phrases[0];
    expect(retranslated.id).toBe(base.id);
    expect(retranslated.revision).not.toBe(base.revision);
    expect(base.revision).toBe(phraseRevisionOf(base));
    expect(phraseRevisionOf({ ...base, note: "Примечание" })).not.toBe(base.revision);
  });
  it("отклоняет неверные ссылки, вид карточки и происхождение", () => {
    expect(() => mixed({ lesson: { title: "x", items: [{ kind: "phrase", id: "нет" }] } })).toThrow(
      /фразы нет нет в phrases/,
    );
    expect(() => mixed({ lesson: { title: "x", items: [{ kind: "grammar", id: "g" }] } })).toThrow(/вид карточки/);
    expect(() => mixed({ lesson: { title: "x", items: [{ kind: "cloze", id: "c-1" }] } })).toThrow(/вид карточки/);
    expect(() => mixed({ phrases: { "p-grafo": { ...phrase, provenance: undefined } } })).toThrow(/provenance/);
    expect(() =>
      mixed({
        phrases: { "p-grafo": { ...phrase, provenance: { sourceLabel: "Агент", operation: "requested-generation" } } },
      }),
    ).toThrow(/request/);
  });
  it("отклоняет дубликаты и сирот", () => {
    expect(() => mixed({ phrases: { "p-grafo": phrase, "p-twin": phrase } })).toThrow(
      /phrases\/p-twin.yaml повторяет фразу/,
    );
    expect(() =>
      mixed({
        phrases: { "p-grafo": phrase, "p-orphan": second },
        lesson: { title: "x", items: [{ kind: "phrase", id: "p-grafo" }] },
      }),
    ).toThrow(/phrases\/p-orphan.yaml не входит ни в один урок/);
    const two = pack(mixed({ phrases: { "p-grafo": phrase, "p-other": second } }));
    expect(two.phrases.map((p) => p.id).sort()).toEqual(["p-grafo", "p-other"]);
  });
  it("прежние YAML собираются без изменений материала", () => {
    const before = buildContent();
    const after = mixed();
    for (const p of before.packages) expect(after.packages.find((q) => q.id === p.id)!.words, p.id).toEqual(p.words);
  });
});
