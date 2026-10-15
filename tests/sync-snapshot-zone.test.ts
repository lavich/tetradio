import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeSession } from "../src/domain/learning";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import {
  applySnapshot,
  buildAndCommitMarked,
  buildSnapshot,
  readSnapshot,
  SNAPSHOT_TABLES,
} from "../src/sync/snapshot";
import { completeLessons, installLessons } from "./helpers/content";
import { submitAnswer } from "./helpers/ops";

const now = new Date("2026-09-16T08:00:00Z");
const db = new AppDatabase("tetradio-snapshot-zone");

// Обращение к таблице вне явной транзакции: Dexie открыл для него свою, и снимок собран из разных моментов.
const outside: string[] = [];
let checking = false;
db.use({
  stack: "dbcore",
  name: "outside-transaction",
  level: 100,
  create: (down) => ({
    ...down,
    table: (name) => {
      const table = down.table(name);
      const check = (req: { trans: unknown }) => {
        if (checking && !(req.trans as { _explicit?: boolean })._explicit) outside.push(name);
      };
      return {
        ...table,
        get: (req) => (check(req), table.get(req)),
        getMany: (req) => (check(req), table.getMany(req)),
        query: (req) => (check(req), table.query(req)),
        count: (req) => (check(req), table.count(req)),
        openCursor: (req) => (check(req), table.openCursor(req)),
        mutate: (req) => (check(req), table.mutate(req)),
      };
    },
  }),
});

async function watched<T>(run: () => Promise<T>): Promise<T> {
  outside.length = 0;
  checking = true;
  try {
    return await run();
  } finally {
    checking = false;
  }
}

describe("снимок собирается и применяется целиком внутри своих транзакций", () => {
  beforeAll(async () => {
    await db.delete();
    await db.open();
    await installLessons(db, ["mech-1"]);
    await completeLessons(db, ["mech-1"]);
    const session = await makeSession({ source: dexieSource(db), now, random: () => 0.42 });
    await db.sessions.add(session);
    for (const item of session.items.slice(0, 3))
      await submitAnswer({
        session,
        item,
        correct: true,
        answer: "",
        responseTimeMs: 900,
        activeTimeMs: 900,
        timezone: "UTC",
        now,
        database: db,
      });
  });
  afterAll(() => db.close());

  it("чтение снимка для выбора версии", async () => {
    const snapshot = await watched(() => readSnapshot(db, now));
    expect(snapshot.stats.answers).toBeGreaterThan(0);
    expect(outside).toEqual([]);
  });

  it("сборка снимка из вложенной функции внутри транзакции чтения", async () => {
    const collect = async () => buildSnapshot(db, now);
    const snapshot = await watched(() =>
      db.transaction(
        "r",
        SNAPSHOT_TABLES.map((name) => db.table(name)),
        () => collect(),
      ),
    );
    expect(snapshot.stats.answers).toBeGreaterThan(0);
    expect(outside).toEqual([]);
  });

  it("сборка снимка для публикации", async () => {
    const { snapshot } = await watched(() => buildAndCommitMarked(db, now, "local-1"));
    expect(snapshot.states.length).toBeGreaterThan(0);
    expect(outside).toEqual([]);
  });

  it("применение версии", async () => {
    const snapshot = await readSnapshot(db, now);
    expect(await watched(() => applySnapshot(db, snapshot, "remote-1", { remote: 1 }, now))).toBe(true);
    expect(outside).toEqual([]);
  });
});
