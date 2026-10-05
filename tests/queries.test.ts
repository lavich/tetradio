import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { indexWord, AppDatabase } from "../src/storage/db";
import {
  dexieSource,
  lessonDetail,
  lessonMates,
  lessonsOfCard,
  lessonViews,
  searchWordIds,
} from "../src/storage/queries";
import { makePlan, makeSession } from "../src/domain/learning";
import { installMixed, MIXED_LESSON, mixedPackage } from "./helpers/mixed";
import { mulberry32 } from "./plan-golden.test";
import { fromSnapshot, type Snapshot } from "./helpers/snapshot-source";
import { lessonProgress, progress, wordMaturity } from "../src/domain/stats";
import { State } from "ts-fsrs";
import { type LessonItem, type Word } from "../src/domain/types";
import { itemOfLink, unitKey, wordKeyOf, wordState } from "./helpers/cards";
import { recordFor, scenarios } from "./plan-golden.test";
import { completeLessons, content, installLessons, wordCountOf } from "./helpers/content";

let db: AppDatabase;
beforeEach(async () => {
  await new AppDatabase("tetradio-queries").delete();
  db = new AppDatabase("tetradio-queries");
  await db.open();
});
const now = new Date("2026-09-15T09:00:00Z");
const iso = now.toISOString();
const word = (index: number, over: Partial<Word> = {}): Word => ({
  id: `w${String(index).padStart(5, "0")}`,
  greek: `το λέξη${index}`,
  russian: `слово${index}`,
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
/** Снимок раскладывается в базу как есть; порядок массивов приводится к порядку ключей, как у Dexie. */
async function load(data: Snapshot) {
  await db.transaction("rw", db.tables, async () => {
    await db.words.bulkAdd(data.words.map(indexWord));
    await db.lessons.bulkAdd(data.lessons);
    if (data.courses) await db.courses.bulkAdd(data.courses);
    if (data.modules) await db.modules.bulkAdd(data.modules);
    await db.lessonItems.bulkAdd(data.links.map(itemOfLink));
    await db.cardStates.bulkAdd(data.states);
    await db.events.bulkAdd(data.events);
    await db.sessions.bulkAdd(data.sessions);
  });
  const byId = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...data, words: byId(data.words), lessons: byId(data.lessons) };
}

describe("эквивалентность планирования на базе и на снимке", () => {
  for (const [name, data] of Object.entries(scenarios)) {
    it(`сценарий ${name}: очередь, задания и варианты совпадают при том же источнике случайности`, async () => {
      const sorted = await load(data);
      const ids = data.words.slice(0, 3).map((w) => w.id);
      const [fromDb, fromMemory] = await Promise.all([
        recordFor(dexieSource(db), ids),
        recordFor(fromSnapshot(sorted), ids),
      ]);
      expect(fromDb).toEqual(fromMemory);
      expect(await progress(dexieSource(db), now)).toEqual(await progress(fromSnapshot(sorted), now));
    });
  }
  it("слова неустановленного урока не существуют локально и не попадают в очередь", async () => {
    await installLessons(db, ["mech-1"]);
    expect((await db.lessons.toArray()).map((l) => l.id)).toEqual(["mech-1"]);
    expect(await db.catalog.count()).toBe(content.catalog.lessons.length);
    expect(await db.words.count()).toBe(wordCountOf("mech-1"));
  });
});

describe("прогресс урока", () => {
  const state = (id: string, fsrs: State, days: number) =>
    [
      wordKeyOf(id),
      wordState(id, { introducedAt: iso, version: 1, card: { due: now, state: fsrs, scheduled_days: days } as never }),
    ] as const;
  it("группирует слова на устойчивые, в повторении и новые по границам статистики", () => {
    const states = new Map([
      state("a", State.Review, 21),
      state("b", State.Review, 20),
      state("c", State.Learning, 0),
      state("d", State.Relearning, 1),
      state("e", State.New, 0),
    ]);
    const groups = lessonProgress(["a", "b", "c", "d", "e", "f", "g"].map(wordKeyOf), states);
    expect(groups).toMatchObject({ solid: 1, review: 4, fresh: 2 });
    // Зрелость: устойчивое слово — единица, двадцатидневное — почти единица, три едва начатых — по одной двадцать первой.
    expect(groups.mature).toBeCloseTo(1 + 20 / 21 + 3 / 21, 10);
    expect(lessonProgress([], states)).toEqual({ solid: 0, review: 0, fresh: 0, mature: 0 });
  });
  it("зрелость слова растёт вместе с интервалом и упирается в порог", () => {
    const card = (days: number, fsrs = State.Review) => state("x", fsrs, days)[1];
    expect(wordMaturity()).toBe(0); // слово без состояния
    expect(wordMaturity(card(0, State.Learning))).toBeCloseTo(1 / 21, 10); // введено сегодня — видно, но мало
    expect(wordMaturity(card(10))).toBeCloseTo(10 / 21, 10);
    expect(wordMaturity(card(21))).toBe(1);
    expect(wordMaturity(card(90))).toBe(1); // сверх порога больше единицы не бывает
  });
  it("список уроков считает группы из одной выборки состояний по живым словам", async () => {
    const words = Array.from({ length: 8 }, (_, i) => word(i));
    await load({
      words: words.filter((_, i) => i !== 6),
      lessons: [
        { id: "l", title: "Урок 1.1", completed: false, updatedAt: iso },
        { id: "empty", title: "Пустой", completed: false, updatedAt: iso },
      ],
      links: words.map((w, position) => ({ lessonId: "l", wordId: w.id, position })),
      states: [
        wordState(words[0].id, {
          introducedAt: iso,
          version: 1,
          card: { due: now, state: State.Review, scheduled_days: 30 } as never,
        }),
        wordState(words[1].id, {
          introducedAt: iso,
          version: 1,
          card: { due: now, state: State.Review, scheduled_days: 5 } as never,
        }),
        wordState(words[2].id, {
          introducedAt: iso,
          version: 1,
          card: { due: now, state: State.Learning, scheduled_days: 0 } as never,
        }),
        wordState(words[6].id, {
          introducedAt: iso,
          version: 1,
          card: { due: now, state: State.Review, scheduled_days: 40 } as never,
        }),
      ],
      events: [],
      sessions: [],
    });
    const plain = await lessonViews(db);
    expect(plain.map((view) => [view.cardCount, view.progress])).toEqual([
      [0, undefined],
      [8, undefined],
    ]);
    const [empty, lesson] = await lessonViews(db, true);
    expect(lesson.cardCount).toBe(7);
    expect(lesson.wordCount).toBe(7);
    expect(lesson.progress).toMatchObject({ solid: 1, review: 2, fresh: 4 }); // слово без записи с устойчивым состоянием не считается
    expect(lesson.progress!.mature).toBeCloseTo(1 + 5 / 21 + 1 / 21, 10);
    expect(empty.progress).toEqual({ solid: 0, review: 0, fresh: 0, mature: 0 });
  });
});

describe("локальный поиск", () => {
  it("ищет по началу токенов без учёта диакритики и регистра, по греческому и русскому", async () => {
    await installLessons(db, ["mech-2"]);
    expect(await searchWordIds("φιλο", db)).toEqual(["w034"]);
    expect(await searchWordIds("ΦΊΛΟ", db)).toEqual(["w034"]);
    expect(await searchWordIds("друг", db)).toContain("w034");
    expect(await searchWordIds("ίλος", db)).toEqual([]); // не подстрока, а префикс токена
  });
  it("несколько слов запроса сужают выборку", async () => {
    const words = Array.from({ length: 120 }, (_, i) =>
      word(i, { greek: `το κοινό${i}`, russian: i % 2 ? `общее слово${i}` : `другое${i}` }),
    );
    await load({ words, lessons: [], links: [], states: [], events: [], sessions: [] });
    const ids = await searchWordIds("κοιν общ", db);
    expect(ids).toHaveLength(60);
  });
});

describe("смешанный урок в выборках", () => {
  it("список уроков считает состав по видам и прогресс по ключам связей; урок без слов не пуст", async () => {
    await installMixed(db);
    await db.cardStates.add({
      unitKey: unitKey({ kind: "phrase", id: "p-xora" }),
      ref: { kind: "phrase", id: "p-xora" },
      introducedAt: iso,
      version: 1,
      card: { due: now, state: State.Review, scheduled_days: 30 } as never,
    });
    await db.cardStates.add({
      unitKey: unitKey({ kind: "phrase", id: "p-grafo" }),
      ref: { kind: "phrase", id: "p-grafo" },
      introducedAt: iso,
      version: 1,
      card: { due: now, state: State.Learning, scheduled_days: 0 } as never,
    });
    const [view] = (await lessonViews(db, true)).filter((v) => v.id === MIXED_LESSON);
    expect(view).toMatchObject({
      cardCount: 7,
      wordCount: 1,
      phraseCount: 6,
      progress: { solid: 1, review: 1, fresh: 5 },
    });
    const detail = (await lessonDetail(MIXED_LESSON, db))!;
    expect(detail.items.map((item) => item.ref.kind)).toEqual(mixedPackage().items.map((item) => item.kind));
    expect(detail.words.map((w) => w.id)).toEqual(["w070"]);
    expect(detail.phrases.map((p) => p.id)).toEqual([
      "p-grafo",
      "p-xora",
      "p-paidi",
      "p-lemeso",
      "p-oikogeneia",
      "p-silent",
    ]);
    expect(detail.states.size).toBe(2);
    // Убранная фраза исчезает из состава, но не из базы.
    await db.lessonItems.delete([MIXED_LESSON, unitKey({ kind: "phrase", id: "p-silent" })]);
    expect((await lessonDetail(MIXED_LESSON, db))!.phrases).toHaveLength(5);
    expect(await db.phrases.get("p-silent")).toBeTruthy();
    expect(await lessonsOfCard({ kind: "phrase", id: "p-grafo" }, db)).toHaveLength(1);
  });
  it("план и сессия на базе совпадают со снимком для смешанного урока при том же источнике случайности", async () => {
    await installMixed(db);
    await completeLessons(db, [MIXED_LESSON]);
    const data: Snapshot = {
      words: await db.words.toArray(),
      phrases: await db.phrases.toArray(),
      lessons: await db.lessons.toArray(),
      courses: await db.courses.toArray(),
      links: [],
      items: await db.lessonItems.toArray(),
      states: [],
      events: [],
      sessions: [],
    };
    const refs = [
      { kind: "phrase" as const, id: "p-xora" },
      { kind: "phrase" as const, id: "p-grafo" },
      { kind: "word" as const, id: "w070" },
    ];
    const record = async (source: ReturnType<typeof dexieSource>) => ({
      plan: (({ newRefs, unavailable, origins }) => ({ newRefs, unavailable, origins }))(
        await makePlan(source, now, { hasVoice: true }),
      ),
      session: (await makeSession({ source, now, random: mulberry32(5), hasVoice: true })).items.map((item) => ({
        key: item.unitKey,
        type: item.type,
        options: item.options,
        isNew: item.isNew,
      })),
      practice: (await makeSession({ source, now, random: mulberry32(9), mode: "practice", refs })).items.map(
        (item) => ({ key: item.unitKey, type: item.type, options: item.options }),
      ),
    });
    const [fromDb, fromMemory] = await Promise.all([record(dexieSource(db)), record(fromSnapshot(data))]);
    expect(fromDb).toEqual(fromMemory);
    expect(fromDb.plan.unavailable).toEqual([]); // с голосом и пятью фразами фраза без перевода проверяема аудированием
    expect((await makePlan(dexieSource(db), now)).unavailable).toEqual([{ kind: "phrase", id: "p-silent" }]);
    expect(fromDb.session.some((item) => item.key.startsWith('["phrase"'))).toBe(true);
  });
});

describe("соседи по уроку", () => {
  const big = Array.from({ length: 40 }, (_, i) => word(i));
  const extra = [word(100), word(101)];
  const target = big[4];
  const at = (lessonId: string, ref: LessonItem["ref"], position: number): LessonItem => ({
    lessonId,
    unitKey: unitKey(ref),
    ref,
    position,
  });
  const items: LessonItem[] = [
    // Связь восьмого слова снята: позиция остаётся пустой, и окно за счёт следующих позиций не расширяется.
    ...big.flatMap((w, i) => (i === 8 ? [] : [at("big", { kind: "word", id: w.id }, i)])),
    at("second", { kind: "word", id: extra[0].id }, 0),
    at("second", { kind: "word", id: target.id }, 1),
    at("second", { kind: "word", id: extra[1].id }, 2),
    at("second", { kind: "phrase", id: "p1" }, 3),
  ];
  const words = [...big.filter((_, i) => i !== 6), ...extra];
  const expected = [0, 1, 2, 3, 5, 7, 9, 10].map((i) => big[i].id).concat(extra.map((w) => w.id));
  const ids = (list: Word[] | undefined) => new Set((list ?? []).map((w) => w.id));

  it("окно в шесть позиций во всех уроках слова, без отсутствующих слов и фраз", async () => {
    await db.words.bulkAdd(words.map(indexWord));
    await db.lessonItems.bulkAdd(items);
    const mates = await lessonMates([target.id, big[39].id, "missing"], db);
    expect(ids(mates.get(target.id))).toEqual(new Set(expected));
    expect(ids(mates.get(big[39].id))).toEqual(new Set([33, 34, 35, 36, 37, 38].map((i) => big[i].id)));
    expect(mates.get("missing")).toEqual([]);
  });
  it("снимок даёт тех же соседей, что и база", async () => {
    await db.words.bulkAdd(words.map(indexWord));
    await db.lessonItems.bulkAdd(items);
    const snapshot: Snapshot = {
      words,
      lessons: [],
      links: [],
      items,
      states: [],
      events: [],
      sessions: [],
    };
    const all = words.map((w) => w.id);
    const [fromDb, fromMemory] = await Promise.all([
      dexieSource(db).lessonMatesOf(all),
      fromSnapshot(snapshot).lessonMatesOf(all),
    ]);
    for (const id of all) expect(ids(fromDb.get(id))).toEqual(ids(fromMemory.get(id)));
  });
});
