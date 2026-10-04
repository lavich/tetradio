import { describe, expect, it } from "vitest";
import { ContentError, parseCatalog, parsePackage, SCHEMA_VERSION, type ContentPackage } from "../src/content/schema";
import { content } from "./helpers/content";

const provenance = {
  sourceLabel: "Иллюстрация формата",
  locator: "fixture",
  excerpt: "Γράφω ένα γράμμα.",
  operation: "verbatim" as const,
};
const word = content.packages[0].words[0];
const phrase = {
  id: "p-1",
  text: "Καλημέρα.",
  translation: "Доброе утро.",
  provenance,
  revision: "r1",
};
const second = { ...phrase, id: "p-2", text: "Γράφω ένα γράμμα.", translation: "Я пишу письмо.", revision: "r2" };
const mixed: Record<string, unknown> = {
  schemaVersion: 4,
  id: "mixed",
  courseId: "c",
  version: "v1",
  language: "el",
  lesson: { title: "Смешанный" },
  words: [word],
  phrases: [phrase, second],
  items: [
    { kind: "phrase", id: "p-1", position: 0 },
    { kind: "word", id: word.id, position: 1 },
    { kind: "phrase", id: "p-2", position: 2 },
  ],
  media: content.packages[0].media.filter((item) => item.id === word.imageAssetId || item.id === word.audioAssetId),
};

describe("смешанный пакет", () => {
  it("смешанный пакет проходит проверку и сохраняет порядок карточек", () => {
    const pack = parsePackage(mixed);
    expect(pack.items.map((item) => [item.kind, item.id])).toEqual([
      ["phrase", "p-1"],
      ["word", word.id],
      ["phrase", "p-2"],
    ]);
    expect(pack.phrases[0]).toMatchObject({ text: "Καλημέρα.", translation: "Доброе утро." });
  });
  it("пакет без слов допустим при наличии других карточек", () => {
    const pack = parsePackage({
      ...mixed,
      words: [],
      media: [],
      items: [
        { kind: "phrase", id: "p-1", position: 0 },
        { kind: "phrase", id: "p-2", position: 1 },
      ],
    });
    expect(pack.words).toEqual([]);
    expect(pack.items).toHaveLength(2);
    expect(() => parsePackage({ ...mixed, words: [], phrases: [], media: [], items: [] })).toThrow(/нет карточек/);
  });
  it("состав со снятым видом карточек отклоняет пакет целиком", () => {
    expect(() =>
      parsePackage({ ...mixed, items: [...(mixed.items as unknown[]), { kind: "cloze", id: "c-1", position: 3 }] }),
    ).toThrow(/вид карточки/);
  });
  it("отклоняет неверные ссылки, дубликаты и вид карточки", () => {
    expect(() =>
      parsePackage({ ...mixed, items: [...(mixed.items as unknown[]), { kind: "phrase", id: "нет", position: 3 }] }),
    ).toThrow(/которой нет в пакете/);
    expect(() =>
      parsePackage({ ...mixed, items: [...(mixed.items as unknown[]), { kind: "grammar", id: "g", position: 3 }] }),
    ).toThrow(/вид карточки/);
    expect(() =>
      parsePackage({ ...mixed, items: [...(mixed.items as unknown[]), { kind: "phrase", id: "p-1", position: 3 }] }),
    ).toThrow(/повторяются/);
    expect(() => parsePackage({ ...mixed, phrases: [phrase, phrase] })).toThrow(/повторяются/);
    expect(() =>
      parsePackage({
        ...mixed,
        items: (mixed.items as { position: number }[]).map((item) => ({ ...item, position: 0 })),
      }),
    ).toThrow(/повторяются/);
  });
  it("требует происхождение с операцией и запрос для преобразования и генерации", () => {
    const bad = (patch: Record<string, string | undefined>) => () =>
      parsePackage({ ...mixed, phrases: [{ ...phrase, provenance: { ...provenance, ...patch } }, second] });
    expect(() => parsePackage({ ...mixed, phrases: [{ ...phrase, provenance: undefined }, second] })).toThrow(
      /provenance/,
    );
    expect(bad({ operation: "guessed" })).toThrow(/операция/);
    expect(bad({ operation: "requested-transform" })).toThrow(/request/);
    expect(bad({ operation: "requested-generation" })).toThrow(/request/);
    expect(bad({ sourceLabel: "" })).toThrow(/sourceLabel/);
    expect(
      parsePackage({
        ...mixed,
        phrases: [
          {
            ...phrase,
            provenance: {
              sourceLabel: "Агент по запросу",
              operation: "requested-generation",
              request: "составь пример",
            },
          },
          second,
        ],
      }).phrases[0].provenance.operation,
    ).toBe("requested-generation");
  });
});

describe("версия схемы", () => {
  const current = JSON.parse(
    content.files.find((file) => file.path === content.catalog.lessons[0].url)!.body as string,
  ) as ContentPackage;
  it("читается только схема 4", () => {
    expect(SCHEMA_VERSION).toBe(4);
    expect(parsePackage(current).schemaVersion).toBe(4);
    for (const version of [1, 2, 3, 5]) {
      try {
        parsePackage({ ...current, schemaVersion: version });
        expect.unreachable();
      } catch (error) {
        expect((error as ContentError).kind).toBe("unsupported");
      }
    }
    const catalog = JSON.parse(content.files.find((file) => file.path === "content/catalog.json")!.body as string);
    expect(() => parseCatalog({ ...catalog, schemaVersion: 3 })).toThrow(ContentError);
  });
});

describe("индекс слов в записи каталога", () => {
  const raw = () => JSON.parse(content.files.find((file) => file.path === "content/catalog.json")!.body as string);
  it("список слов читается", () => {
    const catalog = parseCatalog(raw());
    expect(catalog.lessons[0].wordIds).toEqual(content.catalog.lessons[0].wordIds);
  });
  it("каталог без списка слов принимается", () => {
    const old = raw();
    old.lessons = old.lessons.map(({ wordIds: _w, ...entry }: Record<string, unknown>) => entry);
    const catalog = parseCatalog(old);
    expect(catalog.lessons[0]).not.toHaveProperty("wordIds");
  });
  it("нестроковый идентификатор отклоняется с путём поля", () => {
    const broken = raw();
    broken.lessons[1].wordIds = ["w038", 7];
    expect(() => parseCatalog(broken)).toThrow("каталог.lessons[1].wordIds[1]: ожидалась строка");
  });
});
