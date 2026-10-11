import "fake-indexeddb/auto";
import "./helpers/self";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import { AppDatabase } from "../src/storage/db";
import { applySnapshot, buildSnapshot } from "../src/sync/snapshot";
import { adoptKnownForeign } from "../src/storage/foreign";
import { decodeSnapshot, encodeSnapshot } from "../src/sync/codec";
import { serializeCard } from "../src/sync/snapshot";
import { storedKey, unitKey } from "../src/domain/refs";
import { exportFull, restoreBackup } from "../src/features/backup/backup";
import { installLessons } from "./helpers/content";
import { installMixed } from "./helpers/mixed";
import type { ForeignRef } from "../src/domain/types";

const at = Date.parse("2026-09-15T09:00:00.000Z");
const now = new Date(at);
/** Карточка вида `q` и тип проверки `y`, которых эта версия не знает: их пишет более новый клиент. */
const FOREIGN = "qm03-2/numbers/m3";
const wire = (format: number) => ({
  f: format,
  c: at,
  s: {},
  cs: [],
  l: [],
  p: [],
  b: [],
  st: [[FOREIGN, at, 2.5, 5.1, 1, 3, 4, 1, 2, 0, at - 86_400_000, at - 172_800_000, 3]],
  sk: [
    [FOREIGN, "y", 0, { y: ["10", at] }],
    ["ww1", "ry", 0, { r: ["1", at], y: ["0", at] }],
  ],
  x: { d: [["2026-09-15", 2, [FOREIGN, "ww1"]]], r: { r: "1", y: "10" }, n: 2, w: [FOREIGN, "ww1"] },
});

describe("формат 5: незнакомые виды и типы", () => {
  it("круг разбора и записи сохраняет незнакомые вид и тип без изменений", () => {
    const text = JSON.stringify(wire(5));
    expect(JSON.parse(encodeSnapshot(decodeSnapshot(text)))).toEqual(wire(5));
    expect(encodeSnapshot(decodeSnapshot(text))).not.toContain("undefined");
  });

  it("код снятого вида отбрасывается и в формате 5", () => {
    const old = wire(5);
    old.st = [["cc-1", ...old.st[0].slice(1)] as (typeof old.st)[number]];
    expect(decodeSnapshot(JSON.stringify(old)).states).toEqual([]);
  });

  it("в формате 4 незнакомые вид и тип отбрасываются, как раньше", () => {
    const decoded = decodeSnapshot(JSON.stringify(wire(4)));
    expect(decoded.states).toEqual([]);
    expect(decoded.skills.map((entry) => storedKey(entry.ref))).toEqual([unitKey({ kind: "word", id: "w1" })]);
    expect(Object.keys(decoded.skills[0].skills.types)).toEqual(["recognition"]);
    expect(decoded.stats.recentByType).toEqual({ recognition: [true] });
    expect(decoded.stats.answeredKeys).toEqual([unitKey({ kind: "word", id: "w1" })]);
  });
});

describe("устройство без вида", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    await Dexie.delete("tetradio-foreign");
    db = new AppDatabase("tetradio-foreign");
    await db.open();
  });
  afterEach(async () => {
    db.close();
    await Dexie.delete("tetradio-foreign");
  });

  it("применяет снимок и публикует состояние, навыки и статистику незнакомого вида без изменений", async () => {
    const incoming = decodeSnapshot(JSON.stringify(wire(5)));
    expect(await applySnapshot(db, incoming, "new-1", { new: 1 }, now)).toBe(true);
    expect(await db.cardStates.count()).toBe(0);
    expect((await db.cardStash.toArray()).map((row) => row.ref)).toEqual([{ code: "q", id: "m03-2/numbers/m3" }]);
    // Своя публикация — и при выборе «Это устройство» в конфликте — собирается из stash и базы сводок.
    const published = decodeSnapshot(encodeSnapshot(await buildSnapshot(db, now)));
    expect(published.states).toEqual(incoming.states);
    expect(published.skills).toEqual(incoming.skills);
    expect(published.stats).toEqual(incoming.stats);
  });

  it("после обновления узнанный вид получает обычные ключи; состояние с содержимым становится прогрессом", async () => {
    const card = serializeCard(createEmptyCard(now));
    const foreign = (id: string): ForeignRef => ({ code: "p", id });
    for (const id of ["p1", "p2"]) {
      const ref = foreign(id);
      await db.cardStash.put({
        unitKey: storedKey(ref),
        ref,
        state: { ref, card, introducedAt: now.toISOString(), version: 2 },
      });
      await db.cardSkills.put({
        unitKey: storedKey(ref),
        ref,
        skills: { types: {}, lastTypes: [], cleanAssemblies: 0 },
      });
    }
    await db.phrases.add({
      id: "p1",
      text: "Γεια.",
      translation: "Привет.",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    await adoptKnownForeign(db);

    const p1 = unitKey({ kind: "phrase", id: "p1" });
    const p2 = unitKey({ kind: "phrase", id: "p2" });
    expect((await db.cardStates.get(p1))?.version).toBe(2);
    expect((await db.cardStash.toArray()).map((row) => row.unitKey)).toEqual([p2]);
    expect((await db.cardSkills.toArray()).map((row) => row.unitKey).sort()).toEqual([p1, p2].sort());
  });

  it("резервная копия со строками незнакомого вида восстанавливается вместе с ними", async () => {
    await installLessons(db, ["mech-2"]);
    const incoming = decodeSnapshot(JSON.stringify(wire(5)));
    await applySnapshot(db, incoming, "new-1", { new: 1 }, now);
    const parsed = JSON.parse(await (await exportFull(db)).text());
    const copy = new Blob([JSON.stringify({ ...parsed, data: { ...parsed.data, databaseName: "tetradio" } })], {
      type: "application/json",
    });
    const fresh = new AppDatabase("tetradio-foreign-target");
    await fresh.delete();
    await fresh.open();
    try {
      await restoreBackup(copy, fresh);
      const key = storedKey({ code: "q", id: "m03-2/numbers/m3" });
      expect(await fresh.cardStash.get(key)).toBeDefined();
      expect(await fresh.cardSkills.get(key)).toBeDefined();
    } finally {
      fresh.close();
      await fresh.delete();
    }
  });

  it("перенос без узнанных видов и типов не меняет базу и следующую публикацию", async () => {
    await applySnapshot(db, decodeSnapshot(JSON.stringify(wire(5))), "new-1", { new: 1 }, now);
    const before = encodeSnapshot(await buildSnapshot(db, now));
    await adoptKnownForeign(db);
    expect(encodeSnapshot(await buildSnapshot(db, now))).toBe(before);
  });

  it("узнанный тип проверки сливается с известным, ключи карточек в статистике не двоятся", async () => {
    const word = unitKey({ kind: "word", id: "w1" });
    const foreignPhrase = storedKey({ code: "p", id: "p1" });
    const phrase = unitKey({ kind: "phrase", id: "p1" });
    const older = "2026-09-10T09:00:00.000Z";
    await db.cardSkills.put({
      unitKey: word,
      ref: { kind: "word", id: "w1" },
      skills: {
        types: {
          "~r": { recent: [false, false], lastAt: older },
          recognition: { recent: [true], lastAt: now.toISOString() },
        },
        lastTypes: ["~r", "recognition"],
        cleanAssemblies: 0,
      },
    });
    await db.baseSummary.put({
      id: "base",
      asOf: now.toISOString(),
      versionId: "new-1",
      stats: {
        days: [{ date: "2026-09-15", answers: 2, keys: [foreignPhrase, phrase] }],
        recentByType: { "~r": [false], recognition: [true] },
        answers: 2,
        answeredKeys: [foreignPhrase, phrase],
      },
    });

    await adoptKnownForeign(db);

    expect((await db.cardSkills.get(word))?.skills).toEqual({
      types: { recognition: { recent: [false, false, true], lastAt: now.toISOString() } },
      lastTypes: ["recognition", "recognition"],
      cleanAssemblies: 0,
    });
    const stats = (await db.baseSummary.get("base"))!.stats;
    expect(stats.recentByType).toEqual({ recognition: [false, true] });
    expect(stats.days[0].keys).toEqual([phrase]);
    expect(stats.answeredKeys).toEqual([phrase]);
  });

  it("восстановление копии переносит записи узнанного вида", async () => {
    await installLessons(db, ["mech-2"]);
    const ref: ForeignRef = { code: "p", id: "p-unknown" };
    const card = serializeCard(createEmptyCard(now));
    await db.cardStash.put({
      unitKey: storedKey(ref),
      ref,
      state: { ref, card, introducedAt: now.toISOString(), version: 1 },
    });
    const parsed = JSON.parse(await (await exportFull(db)).text());
    const copy = new Blob([JSON.stringify({ ...parsed, data: { ...parsed.data, databaseName: "tetradio" } })], {
      type: "application/json",
    });
    const fresh = new AppDatabase("tetradio-foreign-restore");
    await fresh.delete();
    await fresh.open();
    try {
      await restoreBackup(copy, fresh);
      expect((await fresh.cardStash.toArray()).map((row) => row.unitKey)).toEqual([
        unitKey({ kind: "phrase", id: "p-unknown" }),
      ]);
    } finally {
      fresh.close();
      await fresh.delete();
    }
  });

  it("пакет, вставший раньше переноса, забирает состояние из-под ключа незнакомого вида", async () => {
    const ref: ForeignRef = { code: "p", id: "p-grafo" };
    const card = serializeCard(createEmptyCard(now));
    await db.cardStash.put({
      unitKey: storedKey(ref),
      ref,
      state: { ref, card, introducedAt: now.toISOString(), version: 4 },
    });
    await installMixed(db);
    expect((await db.cardStates.get(unitKey({ kind: "phrase", id: "p-grafo" })))?.version).toBe(4);
    expect(await db.cardStash.count()).toBe(0);
  });
});
