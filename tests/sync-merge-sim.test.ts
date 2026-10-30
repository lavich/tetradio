// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { saveBlockProgress } from "../src/storage/course";
import { submitAnswer } from "./helpers/ops";
import { makeSession } from "../src/domain/learning";
import { kvAdapter } from "../src/sync/adapter";
import { readChain } from "../src/sync/ancestors";
import { SyncCoordinator, type SyncStatus } from "../src/sync/coordinator";
import { normalize } from "../src/sync/merge";
import { memoryTransport, SyncError, type KeyValueTransport, type MemoryTransport } from "../src/sync/transport";
import { KEEP_DAYS, META, progressOf, readMeta, readSnapshot } from "../src/sync/snapshot";
import { installCompleted } from "./helpers/content";

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

interface Run {
  windows: number;
  explained: boolean;
}

async function simulate(seed: number, count: number): Promise<Run> {
  const random = seeded(seed);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  let clockMs = Date.parse("2026-09-16T08:00:00Z");
  const now = () => new Date(clockMs);
  const tick = (minutes = 1) => new Date((clockMs += minutes * 60000));
  const cloud: MemoryTransport = memoryTransport({ limits: { maxKeys: 24 } });
  let failure: { match: (key: string) => boolean; ack: boolean } | null = null;
  const original = cloud.setItem.bind(cloud);
  cloud.setItem = async (key, value) => {
    if (failure?.match(key)) {
      const { ack } = failure;
      failure = null;
      if (ack) await original(key, value);
      throw new SyncError("transport", "Telegram CloudStorage не ответил за 15 с.");
    }
    await original(key, value);
  };
  const coordinator = (db: AppDatabase, hidden: Set<string>) => {
    const view: KeyValueTransport = {
      ...cloud,
      getKeys: async () => (await cloud.getKeys()).filter((key) => !hidden.has(key)),
      getItems: (keys) => cloud.getItems(keys.filter((key) => !hidden.has(key))),
      setItem: (key, value) => cloud.setItem(key, value),
      removeItems: (keys) => cloud.removeItems(keys),
    };
    return new SyncCoordinator({
      database: db,
      adapter: kvAdapter(view),
      now,
      schedule: () => () => undefined,
      retryBaseMs: 1,
    });
  };
  const make = async (index: number) => {
    const db = new AppDatabase(`tetradio-sim-${seed}-${index}`);
    await db.delete();
    await db.open();
    await installCompleted(db, ["mech-1"]);
    const hidden = new Set<string>();
    return { index, db, hidden, sync: coordinator(db, hidden), given: 0, merges: [] as boolean[], publishes: 0 };
  };
  const devices: Awaited<ReturnType<typeof make>>[] = [];
  for (let index = 0; index < count; index++) devices.push(await make(index));
  type Device = (typeof devices)[number];
  const days = new Set<string>();
  const study = async (dev: Device, mode: "scheduled" | "practice") => {
    const session = await makeSession({
      source: dexieSource(dev.db),
      now: tick(),
      random,
      mode,
      ...(mode === "practice" && { refs: (await dev.db.cardStates.toArray()).map((state) => state.ref) }),
    });
    await dev.db.sessions.add(session);
    const items = session.items.filter((item) => !item.eventId).slice(0, 1 + Math.floor(random() * 2));
    for (const item of items) {
      await submitAnswer({
        session,
        item,
        correct: random() > 0.3,
        answer: "",
        responseTimeMs: 900,
        activeTimeMs: 900,
        timezone: "Asia/Nicosia",
        now: tick(),
        database: dev.db,
      });
      dev.given++;
      days.add(now().toISOString().slice(0, 10));
    }
  };
  let windows = 0;
  let rejected = false;
  const exchange = async (dev: Device) => {
    const dirty = !!(await readMeta(dev.db, META.dirty));
    const before = (await dev.db.syncVersions.toArray())
      .filter((row) => row.note === "До объединения")
      .map((row) => row.id);
    const pointer = `p_${await dev.sync.deviceId()}`;
    const published = cloud.store.get(pointer);
    const status: SyncStatus = await dev.sync.exchange();
    const after = (await dev.db.syncVersions.toArray())
      .filter((row) => row.note === "До объединения")
      .map((row) => row.id);
    if (after.some((id) => !before.includes(id))) dev.merges.push(dirty);
    if (cloud.store.get(pointer) !== published) dev.publishes++;
    if (status.conflict) {
      expect(["diverged"], `seed ${seed}: окно ${status.conflict.kind}`).toContain(status.conflict.kind);
      windows++;
      const local = random() < 0.5;
      const chosen = status.conflict.branches.find((branch) => branch.local === local)!;
      rejected = true;
      await dev.sync.resolve(chosen.id);
    }
  };
  await study(devices[0], "scheduled");
  for (const dev of devices) {
    await dev.sync.exchange();
    expect(dev.sync.getStatus().conflict).toBeNull();
  }
  for (let step = 0; step < 40; step++) {
    const dev = pick(devices);
    const action = random();
    if (action < 0.25) await study(dev, "scheduled");
    else if (action < 0.32) await study(dev, "practice");
    else if (action < 0.36)
      await saveBlockProgress("mech-1", `b${Math.floor(random() * 4)}`, { done: true }, dev.db, tick());
    else if (action < 0.39) tick(24 * 60);
    else if (action < 0.42) dev.sync = coordinator(dev.db, dev.hidden);
    else if (action < 0.52) {
      const other = pick(devices.filter((item) => item !== dev));
      dev.hidden.add(`p_${await other.sync.deviceId()}`);
      await exchange(dev);
      dev.hidden.clear();
    } else if (action < 0.6) {
      failure = { match: (key) => key.startsWith("p_"), ack: true };
      await exchange(dev).catch(() => undefined);
      failure = null;
    } else if (action < 0.66) {
      failure = { match: (key) => key.startsWith("v_"), ack: false };
      await exchange(dev).catch(() => undefined);
      failure = null;
    } else await exchange(dev);
  }
  for (let round = 0; round < 6; round++) for (const dev of devices) await exchange(dev);
  const writes = cloud.log.filter((entry) => entry.startsWith("setItem p_")).length;
  for (const dev of devices) await exchange(dev);
  expect(
    cloud.log.filter((entry) => entry.startsWith("setItem p_")).length,
    `seed ${seed}: публикации не кончаются`,
  ).toBe(writes);

  const snapshots = await Promise.all(devices.map((dev) => readSnapshot(dev.db, now())));
  const contents = snapshots.map((snapshot) => progressOf(normalize(snapshot)));
  expect(new Set(contents).size, `seed ${seed}: у устройств разное содержание`).toBe(1);
  const [snapshot] = snapshots;
  if (days.size < KEEP_DAYS)
    expect(
      snapshot.stats.days.reduce((sum, day) => sum + day.answers, 0),
      `seed ${seed}: ответы по дням`,
    ).toBe(snapshot.stats.answers);
  const given = devices.reduce((sum, dev) => sum + dev.given, 0);
  if (rejected) expect(snapshot.stats.answers, `seed ${seed}: ответов больше данных`).toBeLessThanOrEqual(given);
  else expect(snapshot.stats.answers, `seed ${seed}: ответы`).toBe(given);
  for (const dev of devices) {
    const chain = await readChain(dev.db);
    expect(chain.filter((link) => link.own && link.confirmed).length).toBeLessThanOrEqual(3);
    expect(chain.filter((link) => link.own && !link.confirmed)).toEqual([]);
    expect(chain.filter((link) => !link.own).length).toBeLessThanOrEqual(count);
  }
  const dirtyMerges = devices.filter((dev) => dev.merges.some((dirty) => dirty)).length;
  const explained = dirtyMerges >= 2 || devices.some((dev) => dev.publishes > 3);
  await Promise.all(devices.map((dev) => dev.db.delete()));
  return { windows, explained };
}

describe("случайные чередования", () => {
  it.runIf(!!process.env.SIM_SEED)("один прогон", async () => {
    await simulate(Number(process.env.SIM_SEED), Number(process.env.SIM_COUNT ?? 3));
  });
  it(
    "два устройства: ответы не теряются и не удваиваются, окно — только при законной истории",
    { timeout: 300_000 },
    async () => {
      let windows = 0;
      for (let seed = 1; seed <= 150; seed++) {
        const run = await simulate(seed, 2);
        if (run.windows) expect(run.explained, `seed ${seed}: окно без законной истории`).toBe(true);
        windows += run.windows;
      }
      expect(windows).toBeLessThanOrEqual(15);
    },
  );
  it(
    "три устройства: ответы не теряются и не удваиваются, окно — только при законной истории",
    { timeout: 300_000 },
    async () => {
      let windows = 0;
      for (let seed = 1001; seed <= 1100; seed++) {
        const run = await simulate(seed, 3);
        if (run.windows) expect(run.explained, `seed ${seed}: окно без законной истории`).toBe(true);
        windows += run.windows;
      }
      expect(windows).toBeLessThanOrEqual(15);
    },
  );
});
