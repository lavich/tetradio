import "fake-indexeddb/auto";
import { liveQuery } from "dexie";
import { Rating } from "ts-fsrs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { revisionOf } from "../content/build";
import { applyPackage, installLesson, refreshCatalog } from "../src/content/client";
import { nextState } from "../src/domain/learning";
import { unitKey, wordRef } from "../src/domain/refs";
import { AppDatabase } from "../src/storage/db";
import { dictionary, type DictionaryLesson } from "../src/storage/dictionary";
import { memoryFetcher, packageOf } from "./helpers/content";

const NAME = "tetradio-dictionary-rebuild";
const COURSE = "mechanics";
const now = new Date("2026-09-15T09:00:00Z");
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

function countReads(database: AppDatabase) {
  const keys: Record<string, number> = {};
  const add = (table: string, count: number) => (keys[table] = (keys[table] ?? 0) + count);
  database.use({
    stack: "dbcore",
    name: "read-counter",
    create: (down) => ({
      ...down,
      table: (name) => {
        const table = down.table(name);
        const readonly = (req: { trans: unknown }) => (req.trans as IDBTransaction).mode === "readonly";
        return {
          ...table,
          get: (req) => (readonly(req) && add(name, 1), table.get(req)),
          getMany: (req) => (readonly(req) && add(name, req.keys.length), table.getMany(req)),
          query: async (req) => {
            const res = await table.query(req);
            if (readonly(req) && req.values) {
              add(name, res.result.length);
              add(`${name}:query`, 1);
            }
            return res;
          },
        };
      },
    }),
  });
  return keys;
}

function watch() {
  const seen: DictionaryLesson[][] = [];
  const subscription = liveQuery(() => dictionary(COURSE, db)).subscribe({ next: (value) => seen.push(value) });
  return { last: () => seen.at(-1)!, stop: () => subscription.unsubscribe() };
}

const cold = () => db.transaction("rw", db.tables, () => dictionary(COURSE, db));

const entryOf = (lessons: DictionaryLesson[], id: string) =>
  lessons.flatMap((lesson) => lesson.entries).find((entry) => entry.ref.kind === "word" && entry.ref.id === id);

let db: AppDatabase;
let reads: Record<string, number>;
const fetcher = memoryFetcher();
beforeEach(async () => {
  await new AppDatabase(NAME).delete();
  db = new AppDatabase(NAME);
  reads = countReads(db);
  await refreshCatalog(db, fetcher);
});
afterEach(() => db.close());

describe("словарь во время установки курса", () => {
  it("совпадает с прочитанным заново после установки, повторной установки, обновления и удаления", async () => {
    const live = watch();
    for (const id of ["mech-1", "mech-2", "mech-3", "mech-4"]) await installLesson(id, db, fetcher);
    await settle();
    expect(live.last().map((lesson) => lesson.id)).toEqual(["mech-1", "mech-2", "mech-3", "mech-4"]);
    expect(live.last()).toEqual(await cold());

    expect(await applyPackage(packageOf("mech-2"), db)).toMatchObject({ status: "current" });
    await settle();
    expect(live.last()).toEqual(await cold());

    const pack = packageOf("mech-1");
    const elsewhere = new Set(
      ["mech-2", "mech-3", "mech-4"].flatMap((id) => packageOf(id).items.map((item) => item.id)),
    );
    const [renamed, dropped] = pack.items.filter((item) => item.kind === "word" && !elsewhere.has(item.id));
    const bump = (word: (typeof pack.words)[number]) => {
      const { revision: _revision, ...rest } = word;
      const next = { ...rest, russian: "новый перевод" };
      return { ...next, revision: revisionOf(next) };
    };
    await applyPackage(
      {
        ...pack,
        version: `${pack.version}-next`,
        words: pack.words.map((word) => (word.id === renamed.id ? bump(word) : word)),
        items: pack.items.filter((item) => item.id !== dropped.id),
      },
      db,
    );
    await settle();
    expect(entryOf(live.last(), renamed.id)?.russian).toBe("новый перевод");
    expect(entryOf(live.last(), dropped.id)).toBeUndefined();
    expect(live.last()).toEqual(await cold());

    await db.cardStates.put(nextState(undefined, wordRef(renamed.id), Rating.Good, now));
    await settle();
    expect(entryOf(live.last(), renamed.id)?.mark).not.toBe("new");
    expect(live.last()).toEqual(await cold());

    await db.cardStates.delete(unitKey(wordRef(renamed.id)));
    await settle();
    expect(entryOf(live.last(), renamed.id)?.mark).toBe("new");

    const removed = packageOf("mech-4").items.find((item) => item.kind === "word")!;
    await db.words.delete(removed.id);
    await settle();
    expect(entryOf(live.last(), removed.id)).toBeUndefined();
    expect(live.last()).toEqual(await cold());

    await db.words.clear();
    await settle();
    expect(live.last().flatMap((lesson) => lesson.entries.filter((entry) => entry.word))).toEqual([]);
    expect(live.last()).toEqual(await cold());
    live.stop();
  });

  it("новый пакет перечитывает только свои слова, фразы, связи и состояния", async () => {
    for (const id of ["mech-1", "mech-2", "mech-3"]) await installLesson(id, db, fetcher);
    const live = watch();
    await settle();
    for (const table of Object.keys(reads)) delete reads[table];

    await installLesson("mech-4", db, fetcher);
    await settle();
    const added = packageOf("mech-4");
    expect(live.last().at(-1)!.id).toBe("mech-4");
    expect(reads.words ?? 0).toBeLessThanOrEqual(added.words.length);
    expect(reads.phrases ?? 0).toBeLessThanOrEqual(added.phrases.length);
    expect(reads.lessonItems ?? 0).toBeLessThanOrEqual(added.items.length);
    expect(reads.cardStates ?? 0).toBeLessThanOrEqual(added.items.length);
    live.stop();
  });

  it("неизменившиеся уроки остаются теми же объектами", async () => {
    for (const id of ["mech-1", "mech-2"]) await installLesson(id, db, fetcher);
    const live = watch();
    await settle();
    const before = live.last();
    await installLesson("mech-3", db, fetcher);
    await settle();
    expect(live.last().slice(0, 2)).toEqual(before);
    expect(live.last()[0]).toBe(before[0]);
    expect(live.last()[1]).toBe(before[1]);
    live.stop();
  });

  it("новая отметка меняет только свой урок", async () => {
    for (const id of ["mech-1", "mech-2", "mech-3"]) await installLesson(id, db, fetcher);
    const live = watch();
    await settle();
    const before = live.last();
    const first = before[0].entries.find((entry) => entry.ref.kind === "word")!;
    await db.cardStates.put(nextState(undefined, first.ref, Rating.Good, now));
    await settle();
    expect(live.last()[0]).not.toBe(before[0]);
    expect(entryOf(live.last(), first.ref.id)?.mark).toBe("learning");
    expect(live.last()[1]).toBe(before[1]);
    expect(live.last()[2]).toBe(before[2]);
    live.stop();
  });

  it("пакет из 50+ слов сбрасывает кэш слов целиком, следующий пакет — снова только свои", async () => {
    for (const id of ["mech-1", "mech-2"]) await installLesson(id, db, fetcher);
    const live = watch();
    await settle();
    const base = packageOf("mech-3");
    const words = Array.from({ length: 55 }, (_, index) => {
      const { revision: _revision, ...rest } = base.words[0];
      const next = { ...rest, id: `big-${index}`, greek: `λέξη${index}`, russian: `слово ${index}` };
      return { ...next, revision: revisionOf(next) };
    });
    const big = {
      ...base,
      id: "mech-big",
      lesson: { ...base.lesson, title: "Большой урок" },
      words,
      phrases: [],
      items: words.map((word, position) => ({ kind: "word" as const, id: word.id, position })),
      media: [],
      readings: undefined,
    };
    for (const table of Object.keys(reads)) delete reads[table];
    await applyPackage(big, db);
    await settle();
    expect(live.last().at(-1)!.entries).toHaveLength(55);
    expect(reads.words).toBe(await db.words.count());
    expect(live.last()).toEqual(await cold());

    for (const table of Object.keys(reads)) delete reads[table];
    await installLesson("mech-4", db, fetcher);
    await settle();
    expect(reads.words ?? 0).toBeLessThanOrEqual(packageOf("mech-4").words.length);
    expect(live.last()).toEqual(await cold());
    live.stop();
  });

  it("связи уроков не читаются запросом, который Dexie кэширует оптимистично", async () => {
    const live = watch();
    for (const id of ["mech-1", "mech-2"]) await installLesson(id, db, fetcher);
    await settle();
    expect(live.last()).toHaveLength(2);
    expect(reads["lessonItems:query"] ?? 0).toBe(0);
    live.stop();
  });
});
