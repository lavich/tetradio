import "fake-indexeddb/auto";
import { forgetAncestors } from "./helpers/sync";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { makeSession } from "../src/domain/learning";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { applySnapshot, META, readMeta, writeMeta } from "../src/sync/snapshot";
import { memoryTransport, type MemoryTransport } from "../src/sync/transport";
import type { CompactSnapshot } from "../src/sync/types";
import { submitAnswer } from "./helpers/ops";
import { installCompleted } from "./helpers/content";
import { FORMAT5_BUILD, loadBuild } from "./helpers/builds";
import fixture from "./fixtures/sync-format6.json";
import mainCloud from "./fixtures/sync-format5-main.json";

let cloud: MemoryTransport;
let clockMs = Date.parse("2026-10-20T08:00:00Z");
const tick = () => new Date((clockMs += 60000));
const now = () => new Date(clockMs);
let counter = 0;
type Build = Awaited<ReturnType<typeof loadBuild>>;
const current: Build = { SyncCoordinator, kvAdapter };

async function device(build: Build, name: string) {
  const db = new AppDatabase(`tetradio-compat-${name}-${++counter}`);
  await db.delete();
  await db.open();
  await installCompleted(db, ["mech-1"]);
  const schedule = vi.fn(() => () => undefined);
  const sync = new build.SyncCoordinator({
    database: db,
    adapter: build.kvAdapter(cloud),
    now,
    label: name,
    schedule,
    retryBaseMs: 1,
  });
  return { db, sync, schedule };
}
type Device = Awaited<ReturnType<typeof device>>;
async function study(dev: Device, answers: boolean[]) {
  const session = await makeSession({ source: dexieSource(dev.db), now: tick(), random: () => 0.31 });
  await dev.db.sessions.add(session);
  const items = session.items.filter((item) => !item.eventId).slice(0, answers.length);
  for (const [index, item] of items.entries())
    await submitAnswer({
      session,
      item,
      correct: answers[index],
      answer: "",
      responseTimeMs: 900,
      activeTimeMs: 900,
      timezone: "Asia/Nicosia",
      now: tick(),
      database: dev.db,
    });
}
const states = async (dev: Device) => dev.db.cardStates.orderBy("unitKey").toArray();
const putFixture = () => {
  for (const [key, value] of Object.entries(fixture.cloud)) cloud.store.set(key, value);
};
const cloudCopy = () => Object.fromEntries(cloud.store);

async function expectUpdateAsked(dev: Device, cloudBefore: Record<string, string>) {
  const before = await states(dev);
  const dirty = await readMeta(dev.db, META.dirty);
  const status = await dev.sync.exchange();
  expect(status.phase).toBe("error");
  expect(status.error).toMatchObject({
    kind: "format",
    message: expect.stringMatching(/(Обновите|Перезапустите) приложение/),
  });
  expect(await states(dev)).toEqual(before);
  expect(await readMeta(dev.db, META.dirty)).toBe(dirty);
  expect(cloudCopy()).toEqual(cloudBefore);
  expect(dev.schedule).not.toHaveBeenCalled();
}

beforeEach(() => {
  cloud = memoryTransport();
  clockMs = Date.parse("2026-10-20T08:00:00Z");
});

describe("сборка формата 5 встречает формат 6", () => {
  it("неопубликованные ответы остаются на устройстве, облако не меняется", async () => {
    const old = await device(await loadBuild(FORMAT5_BUILD), "old");
    await study(old, [true]);
    expect((await old.sync.exchange()).phase).toBe("synced");
    putFixture();
    await study(old, [false, true]);
    await expectUpdateAsked(old, cloudCopy());
  });
  it("первое подключение непустой базы", async () => {
    const old = await device(await loadBuild(FORMAT5_BUILD), "old");
    await study(old, [true]);
    putFixture();
    await expectUpdateAsked(old, fixture.cloud);
  });
  it("восстановленная копия", async () => {
    const old = await device(await loadBuild(FORMAT5_BUILD), "old");
    await study(old, [true]);
    await writeMeta(old.db, META.restored, now().toISOString());
    putFixture();
    await expectUpdateAsked(old, fixture.cloud);
  });
  it("окно выбора, открытое до появления формата 6: старая сборка публикует 5 рядом с 6, новая показывает конфликт с обеими ветвями", async () => {
    const legacy = await loadBuild(FORMAT5_BUILD);
    const old = await device(legacy, "old");
    const other = await device(legacy, "other");
    await study(old, [true]);
    expect((await old.sync.exchange()).phase).toBe("synced");
    await other.sync.exchange();
    await study(other, [false]);
    await other.sync.exchange();
    await study(old, [true, true]);
    await forgetAncestors(old.db);
    const conflict = await old.sync.exchange();
    expect(conflict.phase).toBe("conflict");
    putFixture();
    const local = conflict.conflict!.branches.find((branch) => branch.local)!;
    expect((await old.sync.resolve(local.id)).phase).toBe("synced");
    for (const [key, value] of Object.entries(fixture.cloud)) expect(cloud.store.get(key)).toBe(value);
    const oldDevice = await old.sync.deviceId();
    const published = JSON.parse(cloud.store.get(`p_${oldDevice}`)!);
    expect(published.format).toBe(5);
    expect(published.reads).toBeUndefined();

    const fresh = await device(current, "fresh");
    await writeMeta(fresh.db, META.device, "fresh6aa");
    await applySnapshot(fresh.db, fixture.snapshot as CompactSnapshot, "fresh6aa-3", { fresh6aa: 3 }, now());
    const status = await fresh.sync.exchange();
    expect(status.phase).toBe("conflict");
    expect(status.conflict?.kind).toBe("diverged");
    expect(status.conflict?.branches.map((branch) => (branch.local ? "local" : branch.id))).toEqual([
      "local",
      published.id,
    ]);
  });
});

it("облако, записанное кодом main, ветка применяет без конфликта и отвечает форматом 5", async () => {
  for (const [key, value] of Object.entries(mainCloud.cloud)) cloud.store.set(key, value);
  const fresh = await device(current, "fresh");
  expect((await fresh.sync.exchange()).phase).toBe("synced");
  const applied = await fresh.db.cardStates.count();
  expect(applied).toBe(mainCloud.snapshot.states.length);
  const [pointer] = (await kvAdapter(cloud).listPointers()).pointers;
  expect(await kvAdapter(cloud).readVersion(pointer)).toEqual({ ...mainCloud.snapshot, format: 6 });
  await study(fresh, [true]);
  expect((await fresh.sync.exchange()).phase).toBe("synced");
  expect(JSON.parse(cloud.store.get(`p_${await fresh.sync.deviceId()}`)!).format).toBe(5);
});
