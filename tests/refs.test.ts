import { describe, expect, it } from "vitest";
import { parseUnitKey, phraseKey, tryParseUnitKey, unitKey, wordRef, type LearningRef } from "../src/domain/refs";

describe("типизированная ссылка на карточку", () => {
  it("одинаковые ID разных видов дают разные ключи", () => {
    const keys = (["word", "phrase"] as const).map((kind) => unitKey({ kind, id: "x-1" }));
    expect(new Set(keys).size).toBe(2);
  });
  it("ключ восстанавливается в ту же ссылку", () => {
    const ref: LearningRef = { kind: "phrase", id: "p-θέλω-να" };
    expect(parseUnitKey(unitKey(ref))).toEqual(ref);
  });
  it("ссылка на слово сохраняет прежний идентификатор", () => {
    expect(wordRef("w11-01")).toEqual({ kind: "word", id: "w11-01" });
  });
  it("ключ не совпадает с голым ID и не путает разделитель внутри ID", () => {
    expect(unitKey(wordRef("w1"))).not.toBe("w1");
    expect(unitKey({ kind: "word", id: 'a"b' })).not.toBe(unitKey({ kind: "word", id: 'a\\"b' }));
    expect(parseUnitKey(unitKey({ kind: "phrase", id: 'a"b' }))).toEqual({ kind: "phrase", id: 'a"b' });
  });
  it("неизвестный вид карточки отклоняется при разборе ключа", () => {
    expect(() => parseUnitKey(JSON.stringify(["grammar", "g1"]))).toThrow(/вид карточки/);
    expect(() => parseUnitKey("w1")).toThrow(/ключ/);
  });
  it("щадящий разбор отдаёт `null` на снятом виде и всё так же отклоняет негодный ключ", () => {
    expect(tryParseUnitKey(JSON.stringify(["cloze", "c1"]))).toBeNull();
    expect(tryParseUnitKey(unitKey(wordRef("w1")))).toEqual({ kind: "word", id: "w1" });
    expect(() => tryParseUnitKey("w1")).toThrow(/ключ/);
  });
});

describe("ключ дубликата фразы", () => {
  it("фраза — по нормализованному тексту и переводу", () => {
    expect(phraseKey(" Καλημέρα. ", "Доброе  утро")).toBe(phraseKey("καλημέρα.", "доброе утро"));
    expect(phraseKey("Καλημέρα.", "Доброе утро")).not.toBe(phraseKey("Καλημέρα.", "Добрый день"));
    expect(phraseKey("Καλημέρα.", undefined)).not.toBe(phraseKey("Καλημέρα.", "Доброе утро"));
  });
});
