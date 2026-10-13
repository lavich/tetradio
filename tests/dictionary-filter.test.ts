import { describe, expect, it } from "vitest";
import { countMarks, filterDictionary, type CardMark, type DictionaryLesson } from "../src/storage/dictionary";
import { searchTokens } from "../src/storage/db";

const entry = (id: string, greek: string, russian: string, mark: CardMark) => ({
  key: id,
  ref: { kind: "word" as const, id },
  greek,
  russian,
  mark,
  tokens: searchTokens(`${greek} ${russian}`),
});
const lesson = (id: string, entries: ReturnType<typeof entry>[]): DictionaryLesson => ({
  id,
  moduleId: "m01",
  moduleNumber: 1,
  moduleTitle: "",
  number: null,
  title: id,
  entries,
});
const lessons = [
  lesson("a", [entry("w1", "ο φίλος", "друг", "solid"), entry("w2", "το σπίτι", "дом", "new")]),
  lesson("b", [entry("w3", "η φίλη", "подруга", "learning"), entry("w4", "καλός", "хороший", "learning")]),
];
const ids = (shown: DictionaryLesson[]) => shown.map((item) => [item.id, item.entries.map((e) => e.key)]);

describe("фильтр словаря", () => {
  it("без запроса и фильтра — тот же список", () => {
    expect(filterDictionary(lessons, "all", "  ")).toBe(lessons);
  });
  it("запрос — начала слов греческого и перевода, без ударений и регистра; пустые уроки отброшены", () => {
    expect(ids(filterDictionary(lessons, "all", "ΦΙΛ"))).toEqual([
      ["a", ["w1"]],
      ["b", ["w3"]],
    ]);
    expect(ids(filterDictionary(lessons, "all", "дом"))).toEqual([["a", ["w2"]]]);
    expect(ids(filterDictionary(lessons, "all", "φιλ под"))).toEqual([["b", ["w3"]]]);
    expect(filterDictionary(lessons, "all", "ίλος")).toEqual([]);
  });
  it("фильтр состояния вместе с запросом; урок, где подошло всё, — тот же объект", () => {
    const learning = filterDictionary(lessons, "learning", "");
    expect(ids(learning)).toEqual([["b", ["w3", "w4"]]]);
    expect(learning[0]).toBe(lessons[1]);
    expect(ids(filterDictionary(lessons, "solid", "φ"))).toEqual([["a", ["w1"]]]);
  });
  it("счётчики состояний за один проход", () => {
    expect(countMarks(lessons)).toEqual({ all: 4, new: 1, learning: 2, solid: 1 });
    expect(countMarks([])).toEqual({ all: 0, new: 0, learning: 0, solid: 0 });
  });
});
