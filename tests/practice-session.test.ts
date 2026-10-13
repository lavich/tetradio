import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { startSession } from "../src/features/learning/session-actions";
import { AppDatabase } from "../src/storage/db";
import { installCompleted } from "./helpers/content";

const dbs: AppDatabase[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    db.close();
    await db.delete();
  }
});
async function database() {
  const db = new AppDatabase(`tetradio-practice-${dbs.length}`);
  dbs.push(db);
  await db.delete();
  await db.open();
  await installCompleted(db, ["mech-1"]);
  return db;
}
const active = (db: AppDatabase) => db.sessions.where("status").equals("active").toArray();

describe("запуск тренировки", () => {
  it("двойное нажатие оставляет одну незаконченную тренировку", async () => {
    const db = await database();
    const refs = (await db.words.limit(3).toArray()).map((word) => ({ kind: "word" as const, id: word.id }));
    const now = new Date("2026-10-13T10:00:00Z");
    const [first, second] = await Promise.all([
      startSession(now, { refs, mode: "practice" }, db),
      startSession(now, { refs, mode: "practice" }, db),
    ]);
    expect(first && second).toBeTruthy();
    expect(await active(db)).toHaveLength(1);
  });

  it("незаконченное повторение по расписанию тренировка не закрывает", async () => {
    const db = await database();
    const refs = (await db.words.limit(3).toArray()).map((word) => ({ kind: "word" as const, id: word.id }));
    const now = new Date("2026-10-13T10:00:00Z");
    const scheduled = await startSession(now, {}, db);
    await startSession(now, { refs, mode: "practice" }, db);
    expect((await active(db)).map((session) => session.id)).toContain(scheduled!.id);
  });
});
