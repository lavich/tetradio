// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { submitAnswer } from "./helpers/ops";
import { makeSession } from "../src/domain/learning";
import { progress } from "../src/domain/stats";
import { kvAdapter } from "../src/sync/adapter";
import { readChain } from "../src/sync/ancestors";
import { commonClock } from "../src/sync/ancestor-pick";
import { sameClock } from "../src/sync/clock";
import { SyncCoordinator, type SyncStatus } from "../src/sync/coordinator";
import { memoryTransport, SyncError, type KeyValueTransport, type MemoryTransport } from "../src/sync/transport";
import { META, parseClock, readMeta } from "../src/sync/snapshot";
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

/**
 * Случайные чередования ответов, обменов и сбоев на двух-трёх устройствах. После тишины у всех одно содержание,
 * ответов ровно столько, сколько дано, цепочка ограничена. Окно допускается только в классе «объединения с разными
 * входами»: общая часть часов ветвей не совпадает ни с одним звеном цепочки.
 */
async function simulate(seed: number, count: number) {
  const random = seeded(seed);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  let clockMs = Date.parse("2026-09-16T08:00:00Z");
  const now = () => new Date(clockMs);
  const tick = () => new Date((clockMs += 60000));
  const cloud: MemoryTransport = memoryTransport();
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
  // Установка уроков на устройства — по очереди: параллельная делит общий загрузчик содержимого.
  const make = async (index: number) => {
    const db = new AppDatabase(`tetradio-sim-${seed}-${index}`);
    await db.delete();
    await db.open();
    await installCompleted(db, ["mech-1"]);
    const hidden = new Set<string>();
    const view: KeyValueTransport = {
      ...cloud,
      getKeys: async () => (await cloud.getKeys()).filter((key) => !hidden.has(key)),
      getItems: (keys) => cloud.getItems(keys.filter((key) => !hidden.has(key))),
      setItem: (key, value) => cloud.setItem(key, value),
      removeItems: (keys) => cloud.removeItems(keys),
    };
    const sync = new SyncCoordinator({
      database: db,
      adapter: kvAdapter(view),
      now,
      schedule: () => () => undefined,
      retryBaseMs: 1,
    });
    return { index, db, sync, hidden, given: 0, rejected: false };
  };
  const devices: Awaited<ReturnType<typeof make>>[] = [];
  for (let index = 0; index < count; index++) devices.push(await make(index));
  type Device = (typeof devices)[number];
  const study = async (dev: Device) => {
    const session = await makeSession({ source: dexieSource(dev.db), now: tick(), random });
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
    }
  };
  let windows = 0;
  /** Окно — только в разрешённом классе; оно решается выбором своей версии, и счёт ответов дальше не проверяется. */
  const check = async (dev: Device, status: SyncStatus) => {
    if (!status.conflict) return;
    const clocks = status.conflict.branches.map((branch) => (branch.local ? parseClock(null) : branch.meta!.clock));
    const local = parseClock(await readMeta(dev.db, META.clock));
    const issued = Number(await readMeta(dev.db, META.issued)) || 0;
    const device = await dev.sync.deviceId();
    clocks[0] = { ...local, [device]: Math.max(local[device] ?? 0, issued) };
    const common = commonClock(clocks);
    const chain = await readChain(dev.db);
    expect(status.conflict.kind, `seed ${seed}: окно ${status.conflict.kind}`).toBe("diverged");
    // Разрешённые классы: ветви делят историю после общей части (пара версий облака поверх версии, которой здесь нет)
    // или общей части нет среди звеньев (объединения с разными входами).
    const shared = clocks.some((a, i) => clocks.some((b, j) => j > i && !sameClock(commonClock([a, b]), common)));
    expect(
      !shared && chain.some((link) => link.confirmed && sameClock(link.clock, common)),
      `seed ${seed}: окно при общем предке`,
    ).toBe(false);
    windows++;
    dev.rejected = true;
    await dev.sync.resolve(status.conflict.branches.find((branch) => branch.local)!.id);
  };
  // Первое подключение непустой базы к непустому облаку — отдельный случай с окном; устройства подключены заранее.
  await study(devices[0]);
  for (const dev of devices) expect((await dev.sync.exchange()).conflict).toBeNull();
  for (let step = 0; step < 30; step++) {
    const dev = pick(devices);
    const action = random();
    if (action < 0.4) await study(dev);
    else if (action < 0.55) {
      const other = pick(devices.filter((item) => item !== dev));
      dev.hidden.add(`p_${await other.sync.deviceId()}`);
      await check(dev, await dev.sync.exchange());
      dev.hidden.clear();
    } else if (action < 0.65) {
      failure = { match: (key) => key.startsWith("p_"), ack: true };
      await check(dev, await dev.sync.exchange());
      failure = null;
    } else if (action < 0.72) {
      failure = { match: (key) => key.startsWith("v_"), ack: false };
      await check(dev, await dev.sync.exchange());
      failure = null;
    } else await check(dev, await dev.sync.exchange());
  }
  for (let round = 0; round < 6; round++) for (const dev of devices) await check(dev, await dev.sync.exchange());
  const counts = await Promise.all(
    devices.map(async (dev) => (await progress(dexieSource(dev.db), now())).totals.answers),
  );
  expect(new Set(counts).size, `seed ${seed}: у устройств разный итог ${counts.join(", ")}`).toBe(1);
  if (!windows) expect(counts[0], `seed ${seed}: ответы`).toBe(devices.reduce((sum, dev) => sum + dev.given, 0));
  for (const dev of devices)
    expect((await readChain(dev.db)).filter((link) => link.confirmed).length).toBeLessThanOrEqual(4);
  await Promise.all(devices.map((dev) => dev.db.delete()));
  return windows;
}

describe("случайные чередования", () => {
  it.runIf(!!process.env.SIM_SEED)("один прогон", async () => {
    await simulate(Number(process.env.SIM_SEED), Number(process.env.SIM_COUNT ?? 3));
  });
  it(
    "два устройства: ответы не теряются и не удваиваются, окно — редко и только в разрешённых классах",
    { timeout: 300_000 },
    async () => {
      let windows = 0;
      for (let seed = 1; seed <= 150; seed++) windows += await simulate(seed, 2);
      expect(windows).toBeLessThanOrEqual(15);
    },
  );
  it(
    "три устройства: ответы не теряются и не удваиваются, окно только в разрешённых классах",
    { timeout: 300_000 },
    async () => {
      for (let seed = 1001; seed <= 1100; seed++) await simulate(seed, 3);
    },
  );
});
