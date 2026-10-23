import "fake-indexeddb/auto";
import "./helpers/self";
import { Rating } from "ts-fsrs";
import { afterEach, describe, expect, it } from "vitest";
import { applyPackage } from "../src/content/apply";
import { installLesson, refreshCatalog } from "../src/content/client";
import { nextState } from "../src/domain/learning";
import { unitKey, wordRef } from "../src/domain/refs";
import { AppDatabase } from "../src/storage/db";
import { memoryFetcher } from "./helpers/content";
import { realContent } from "./helpers/real-content";

const db = new AppDatabase("tetradio-new-verbs");
afterEach(async () => {
  db.close();
  await db.delete();
});

it("урок, обновлённый новыми карточками, добавляет их и не трогает прежние", async () => {
  const full = realContent().packages.find((pack) => pack.id === "m04-3")!;
  const added = new Set(["w924", "p330"]);
  const before = {
    ...full,
    version: "before",
    words: full.words.filter((word) => !added.has(word.id)),
    phrases: full.phrases.filter((phrase) => !added.has(phrase.id)),
    items: full.items.filter((item) => !added.has(item.id)),
  };
  expect(full.items.map((item) => item.id)).toEqual(expect.arrayContaining([...added]));
  await db.open();
  expect((await applyPackage(before, db)).status).toBe("installed");
  const old = await db.phrases.get("p051");
  const result = await applyPackage(full, db);
  expect(result).toMatchObject({ status: "updated", added: 2, changed: 0 });
  expect((await db.words.get("w924"))?.paradigm?.present[3]).toBe("βρισκόμαστε");
  expect((await db.phrases.get("p330"))?.text).toBe("Πάμε για καφέ;");
  expect(await db.phrases.get("p051")).toEqual(old);
  const links = await db.lessonItems.where("lessonId").equals("m04-3").toArray();
  expect(links.map((link) => link.ref.id)).toEqual(expect.arrayContaining(["p051", "w924", "p330"]));
});

it("слово, поставленное с полной таблицей, получает признак third новой ревизией", async () => {
  const full = realContent().packages.find((pack) => pack.words.some((word) => word.greek === "αρέσω"))!;
  const before = {
    ...full,
    version: "before",
    words: full.words.map(({ paradigm, ...word }) => {
      if (word.greek !== "αρέσω") return { ...word, ...(paradigm ? { paradigm } : {}) };
      const { third: _third, ...plain } = paradigm!;
      return { ...word, revision: "old", paradigm: plain };
    }),
  };
  await db.open();
  await applyPackage(before, db);
  const result = await applyPackage(full, db);
  expect(result).toMatchObject({ status: "updated", added: 0, changed: 1 });
  expect((await db.words.get(full.words.find((word) => word.greek === "αρέσω")!.id))!.paradigm?.third).toBe(true);
});

describe("пакет, поставленный версией без групп", () => {
  const built = realContent();
  const bare = <T extends { group?: unknown; irregular?: unknown }>({ group: _g, irregular: _i, ...rest }: T) => rest;
  const oldClient = <T extends { grouped?: true }>({ grouped: _g, ...rest }: T) => rest;
  const withReadingVerb = built.packages.find((pack) =>
    pack.readings?.some((reading) => reading.marks?.cards.some((card) => card.group)),
  )!;
  async function installed(lessonId: string) {
    const fetcher = memoryFetcher(built);
    await db.open();
    await refreshCatalog(db, fetcher);
    expect((await installLesson(lessonId, db, fetcher)).status).toBe("installed");
    return fetcher;
  }

  it("ставится заново той же версией: у глаголов появляется группа, прогресс и дата слова прежние", async () => {
    const fetcher = await installed("m05-2");
    const stale = (await db.packages.get("m05-2"))!;
    await db.packages.put({ ...oldClient(stale), words: stale.words.map(bare) });
    const id = stale.words.find((word) => word.greek === "έρχομαι")!.id;
    const word = (await db.words.get(id))!;
    await db.words.put(bare(word));
    const state = nextState(undefined, wordRef(id), Rating.Good, new Date());
    await db.cardStates.put(state);

    expect((await installLesson("m05-2", db, fetcher)).status).toBe("updated");
    expect(await db.words.get(id)).toMatchObject({ group: "mid", irregular: true, createdAt: word.createdAt });
    expect(await db.cardStates.get(unitKey(wordRef(id)))).toEqual(state);
    expect((await installLesson("m05-2", db, fetcher)).status).toBe("current");
  });

  it("пакет с группами той же версии повторно не скачивается", async () => {
    const fetcher = await installed("m05-2");
    const requests = fetcher.requests.length;
    expect((await installLesson("m05-2", db, fetcher)).status).toBe("current");
    expect(fetcher.requests).toHaveLength(requests);
  });

  it("глагол без группы только в карточках подсказки урока — пакет ставится заново", async () => {
    const fetcher = await installed("m05-2");
    const stale = (await db.packages.get("m05-2"))!;
    expect(stale.marks!.cards.some((card) => card.group)).toBe(true);
    await db.packages.put({ ...oldClient(stale), marks: { ...stale.marks!, cards: stale.marks!.cards.map(bare) } });
    expect((await installLesson("m05-2", db, fetcher)).status).toBe("updated");
    expect((await db.packages.get("m05-2"))!.marks!.cards.some((card) => card.group)).toBe(true);
  });

  it("глагол без группы только в карточках подсказки текста для чтения — пакет ставится заново", async () => {
    const lessonId = withReadingVerb.id;
    const fetcher = await installed(lessonId);
    const stale = (await db.packages.get(lessonId))!;
    const readings = stale.readings!.map((reading) =>
      reading.marks ? { ...reading, marks: { ...reading.marks, cards: reading.marks.cards.map(bare) } } : reading,
    );
    await db.packages.put({ ...oldClient(stale), readings });
    expect((await installLesson(lessonId, db, fetcher)).status).toBe("updated");
    const cards = (await db.packages.get(lessonId))!.readings!.flatMap((reading) => reading.marks?.cards ?? []);
    expect(cards.some((card) => card.group)).toBe(true);
  });

  it("пакет без групп на сервере (откат контента) после установки новой версией не перекачивается", async () => {
    const pack = built.packages.find((item) => item.id === "m05-2")!;
    const entry = JSON.parse(
      built.files.find((file) => file.path === "content/catalog.json")!.body as string,
    ).lessons.find((lesson: { id: string }) => lesson.id === "m05-2");
    const rolledBack = {
      ...pack,
      words: pack.words.map(bare),
      marks: pack.marks && { ...pack.marks, cards: pack.marks.cards.map(bare) },
      readings: pack.readings?.map((reading) =>
        reading.marks ? { ...reading, marks: { ...reading.marks, cards: reading.marks.cards.map(bare) } } : reading,
      ),
    };
    const fetcher = memoryFetcher(built, { [entry.url]: JSON.parse(JSON.stringify(rolledBack)) });
    await db.open();
    await refreshCatalog(db, fetcher);
    expect((await installLesson("m05-2", db, fetcher)).status).toBe("installed");
    const requests = fetcher.requests.length;
    expect((await installLesson("m05-2", db, fetcher)).status).toBe("current");
    expect(fetcher.requests).toHaveLength(requests);

    await db.packages.put(oldClient((await db.packages.get("m05-2"))!));
    expect((await installLesson("m05-2", db, fetcher)).status).toBe("updated");
    const once = fetcher.requests.length;
    expect((await installLesson("m05-2", db, fetcher)).status).toBe("current");
    expect(fetcher.requests).toHaveLength(once);
  });
});
