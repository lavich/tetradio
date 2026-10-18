import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, expect, it } from "vitest";
import { applyPackage } from "../src/content/apply";
import { AppDatabase } from "../src/storage/db";
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
