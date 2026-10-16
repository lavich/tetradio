import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { lessonOutlines } from "../src/storage/outlines";
import { rowCache } from "../src/storage/row-cache";
import { installLessons } from "./helpers/content";

const NAME = "tetradio-row-cache";
const IDS = ["mech-1", "mech-2", "mech-3"];
const meta = rowCache<{ key: string; value: string }>("meta");
const readMeta = (keys: string[], database: AppDatabase) =>
  meta(keys, database, (missing) => database.meta.bulkGet(missing));

let db: AppDatabase;
beforeEach(async () => {
  await new AppDatabase(NAME).delete();
  db = new AppDatabase(NAME);
});
afterEach(() => db.close());

describe("кэш строк", () => {
  it("явная транзакция чтения не ждёт чужого чтения и не закрывается раньше времени", async () => {
    await installLessons(db, IDS);
    await db.packages.bulkPut(await db.packages.bulkGet(IDS).then((rows) => rows.map((row) => ({ ...row! }))));
    const outside = lessonOutlines(IDS, db);
    const inside = await db.transaction("r", db.packages, db.meta, async () => {
      const outlines = await lessonOutlines(IDS, db);
      await db.meta.get("absent");
      return outlines;
    });
    expect(inside.every(Boolean)).toBe(true);
    expect((await outside).every(Boolean)).toBe(true);
  });

  it("откатившаяся транзакция не роняет посторонних читателей", async () => {
    await db.meta.bulkPut([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
    let outside: Promise<unknown> | undefined;
    await db
      .transaction("r", db.meta, () => {
        void readMeta(["a", "b"], db).catch(() => undefined);
        outside = Dexie.ignoreTransaction(() => readMeta(["a", "b"], db));
        Dexie.currentTransaction!.abort();
      })
      .catch(() => undefined);
    expect(await outside).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
  });

  it("транзакция записи видит свои незафиксированные строки и не оставляет их в кэше", async () => {
    await db.meta.put({ key: "a", value: "1" });
    expect(await readMeta(["a"], db)).toEqual([{ key: "a", value: "1" }]);
    await db
      .transaction("rw", db.meta, async () => {
        await db.meta.put({ key: "a", value: "2" });
        expect(await readMeta(["a"], db)).toEqual([{ key: "a", value: "2" }]);
        throw new Error("откат");
      })
      .catch(() => undefined);
    expect(await readMeta(["a"], db)).toEqual([{ key: "a", value: "1" }]);
  });

  it("отметки изменённых ключей не копятся, когда никто не читает", async () => {
    for (let index = 0; index < 20; index++) {
      await db.meta.put({ key: `k${index}`, value: "1" });
      await readMeta([`k${index}`], db);
    }
    expect(meta.tracked(db)).toBe(0);
  });
});
