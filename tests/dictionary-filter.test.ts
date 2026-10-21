import "fake-indexeddb/auto";
import { Rating } from "ts-fsrs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { installLesson, refreshCatalog } from "../src/content/client";
import { nextState } from "../src/domain/learning";
import { wordRef } from "../src/domain/refs";
import {
  countMarks,
  dictionary,
  filterDictionary,
  languageDictionary,
  type CardMark,
  type DictionaryLesson,
} from "../src/storage/dictionary";
import { AppDatabase, searchTokens } from "../src/storage/db";
import { pauseCourse } from "../src/storage/pause-actions";
import { memoryFetcher } from "./helpers/content";

const entry = (id: string, greek: string, russian: string, mark: CardMark) => ({
  key: id,
  ref: { kind: "word" as const, id },
  greek,
  russian,
  mark,
  tokens: searchTokens(`${greek} ${russian}`),
});
const lesson = (id: string, entries: ReturnType<typeof entry>[], courseId = "greek-a2"): DictionaryLesson => ({
  id,
  courseId,
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

describe("фильтр курса", () => {
  const two = [
    lesson("it", [entry("e1", "a deadline", "срок", "learning"), entry("e2", "a laptop", "ноутбук", "new")], "it"),
    lesson(
      "talk",
      [entry("c1", "a neighbour", "сосед", "learning"), entry("c2", "the weather", "погода", "new")],
      "talk",
    ),
  ];
  it("вместе с фильтром состояния и поиском", () => {
    expect(ids(filterDictionary(two, "all", "", "talk"))).toEqual([["talk", ["c1", "c2"]]]);
    expect(ids(filterDictionary(two, "learning", "", "talk"))).toEqual([["talk", ["c1"]]]);
    expect(ids(filterDictionary(two, "all", "сос", "it"))).toEqual([]);
    expect(filterDictionary(two, "all", "", "talk")[0]).toBe(two[1]);
  });
  it("курс другого языка или неизвестный — все курсы", () => {
    expect(filterDictionary(two, "all", "", "greek-a2")).toBe(two);
    expect(filterDictionary(two, "all", "", "nope")).toBe(two);
  });
});

describe("словарь языка", () => {
  const built = buildContent("tests/fixtures/two-courses");
  const database = new AppDatabase("tetradio-language-dictionary");
  beforeAll(async () => {
    await database.delete();
    await database.open();
    const fetcher = memoryFetcher(built);
    await refreshCatalog(database, fetcher);
    for (const id of ["m01-1", "e01-1", "c01-1"]) await installLesson(id, database, fetcher);
  });
  const words = (lessons: DictionaryLesson[]) => lessons.flatMap((item) => item.entries.map((e) => e.greek));

  it("уроки двух английских курсов по порядку курсов, у урока курс, греческих карточек нет", async () => {
    const lessons = await languageDictionary("en", database);
    expect(lessons.map((item) => [item.id, item.courseId])).toEqual([
      ["e01-1", "english"],
      ["c01-1", "talk"],
    ]);
    expect(words(lessons)).toEqual(expect.arrayContaining(["the bus", "a neighbour"]));
    expect(words(lessons)).not.toContain("γεια");
  });
  it("у языка с одним курсом — словарь этого курса", async () => {
    expect(await languageDictionary("el", database)).toEqual(await dictionary("greek-a2", database));
  });
  it("курс на паузе остаётся в словаре языка", async () => {
    await pauseCourse("talk", new Date(), database);
    expect((await languageDictionary("en", database)).map((item) => item.courseId)).toContain("talk");
  });
  it("без изменений — те же объекты уроков; изменение карточки — новый объект только у её урока", async () => {
    const before = await languageDictionary("en", database);
    const again = await languageDictionary("en", database);
    expect(again[0]).toBe(before[0]);
    expect(again[1]).toBe(before[1]);
    await database.cardStates.put(nextState(undefined, wordRef("c0001"), Rating.Good, new Date()));
    const after = await languageDictionary("en", database);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });
});
