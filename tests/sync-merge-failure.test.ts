// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";

const broken = vi.hoisted(() => ({ on: false }));
vi.mock("../src/sync/merge", async (original) => {
  const module = await original<typeof import("../src/sync/merge")>();
  return {
    ...module,
    mergeSnapshots: (...args: Parameters<typeof module.mergeSnapshots>) => {
      if (broken.on) throw new Error("слияние сломано");
      return module.mergeSnapshots(...args);
    },
  };
});

import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { submitAnswer } from "./helpers/ops";
import { makeSession } from "../src/domain/learning";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { memoryTransport } from "../src/sync/transport";
import { installCompleted } from "./helpers/content";

let clockMs = Date.parse("2026-09-16T08:00:00Z");
const now = () => new Date(clockMs);
const cloud = memoryTransport();
async function device(name: string) {
  const db = new AppDatabase(`tetradio-merge-failure-${name}`);
  await db.delete();
  await db.open();
  await installCompleted(db, ["mech-1"]);
  const sync = new SyncCoordinator({ database: db, adapter: kvAdapter(cloud), now, schedule: () => () => undefined });
  return { db, sync };
}
async function study(dev: Awaited<ReturnType<typeof device>>) {
  clockMs += 60000;
  const session = await makeSession({ source: dexieSource(dev.db), now: now(), random: () => 0.31 });
  await dev.db.sessions.add(session);
  const [item] = session.items;
  clockMs += 60000;
  await submitAnswer({
    session,
    item,
    correct: true,
    answer: "",
    responseTimeMs: 900,
    activeTimeMs: 900,
    timezone: "Asia/Nicosia",
    now: now(),
    database: dev.db,
  });
}

describe("ошибка слияния", () => {
  it("даёт окно выбора с отчётом о сбое и не меняет данные", async () => {
    const phone = await device("phone");
    const mac = await device("mac");
    await study(phone);
    await phone.sync.exchange();
    await mac.sync.exchange();
    await study(phone);
    await study(mac);
    await mac.sync.exchange();
    const states = await phone.db.cardStates.toArray();
    const failure = vi.fn();
    phone.sync.onFailure = failure;
    broken.on = true;
    const status = await phone.sync.exchange();
    expect(status.conflict?.kind).toBe("diverged");
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: "слияние сломано" }), "unknown");
    expect(await phone.db.cardStates.toArray()).toEqual(states);
  });
});
