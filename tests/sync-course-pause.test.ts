import "fake-indexeddb/auto";
import "./helpers/self";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { makeSession } from "../src/domain/learning";
import { readPauses } from "../src/storage/pauses";
import { pauseCourse, resumeCourse } from "../src/storage/pause-actions";
import { kvAdapter, parsePartKey, pausesKey } from "../src/sync/adapter";
import { SyncCoordinator, type CoordinatorOptions } from "../src/sync/coordinator";
import { META, readMeta, readSnapshot } from "../src/sync/snapshot";
import { encodeSnapshot } from "../src/sync/codec";
import { memoryTransport, SyncError, type MemoryTransport, type MemoryTransportOptions } from "../src/sync/transport";
import { exportFull, restoreBackup } from "../src/features/backup/backup";
import { submitAnswer } from "./helpers/ops";
import { installCompleted } from "./helpers/content";

const COURSE = "english";
let cloud: MemoryTransport;
let clockMs = Date.parse("2026-10-20T07:00:00Z");
const tick = (minutes = 1) => new Date((clockMs += minutes * 60000));
const now = () => new Date(clockMs);
let counter = 0;

async function device(name: string, options: Partial<Pick<CoordinatorOptions, "lock">> = {}, transport = cloud) {
  const db = new AppDatabase(`tetradio-sync-pause-${name}-${++counter}`);
  await db.delete();
  await db.open();
  await installCompleted(db, ["mech-1"]);
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(transport),
    now,
    label: name,
    schedule: () => () => undefined,
    retryBaseMs: 1,
    ...options,
  });
  return { db, sync, name };
}
type Device = Awaited<ReturnType<typeof device>>;
async function study(dev: Device, answers: boolean[]) {
  const session = await makeSession({ source: dexieSource(dev.db), now: tick(), random: () => 0.31 });
  await dev.db.sessions.add(session);
  for (const [index, item] of session.items.slice(0, answers.length).entries())
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
const paused = async (dev: Device) => !!(await readPauses(dev.db))[COURSE]?.pausedAt;
const cards = async (dev: Device) =>
  JSON.stringify(
    (await dev.db.cardStates.orderBy("unitKey").toArray()).map((state) => [state.unitKey, state.card.reps]),
  );
const pointer = async (dev: Device) => cloud.store.get(`p_${await dev.sync.deviceId()}`);
async function pair() {
  const phone = await device("phone");
  const tablet = await device("tablet");
  await study(phone, [true, true, true]);
  await phone.sync.exchange();
  await tablet.sync.exchange();
  return { phone, tablet };
}

beforeEach(() => {
  cloud = memoryTransport();
  clockMs = Date.parse("2026-10-20T07:00:00Z");
});

describe("ключ пауз в облаке", () => {
  it("свой ключ на устройство не похож на указатель и часть версии", async () => {
    expect(pausesKey("ab12cd34")).toBe("cp_ab12cd34");
    expect(pausesKey("ab12cd34").startsWith("p_")).toBe(false);
    expect(parsePartKey(pausesKey("ab12cd34_0"))).toBeNull();
    const { phone } = await pair();
    await pauseCourse(COURSE, tick(), phone.db);
    await phone.sync.exchange();
    expect(cloud.store.has(pausesKey(await phone.sync.deviceId()))).toBe(true);
    const listing = await kvAdapter(cloud).listPointers();
    expect(listing.invalid).toEqual([]);
    expect(listing.pointers.map((item) => item.id)).toEqual([JSON.parse((await pointer(phone))!).id]);
    expect(await kvAdapter(cloud).listGenerations()).not.toContainEqual(expect.stringContaining("cp_"));
  });
  it("пауза не меняет версию: ни указатель, ни снимок, ни отметку изменений", async () => {
    const { phone } = await pair();
    const before = await pointer(phone);
    await pauseCourse(COURSE, tick(), phone.db);
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await pointer(phone)).toBe(before);
    expect(encodeSnapshot(await readSnapshot(phone.db, now()))).not.toContain("english");
  });
  it("удаление устройства убирает и его ключ пауз", async () => {
    const { phone, tablet } = await pair();
    await study(tablet, [true]);
    await pauseCourse(COURSE, tick(), tablet.db);
    await tablet.sync.exchange();
    await phone.sync.exchange();
    const adapter = kvAdapter(cloud);
    const tabletDevice = await tablet.sync.deviceId();
    const target = (await adapter.listPointers()).pointers.find((item) => item.device === tabletDevice)!;
    expect(await adapter.removeDevice(target)).toBe(true);
    expect(cloud.store.has(pausesKey(tabletDevice))).toBe(false);
    await phone.sync.exchange();
    expect(await paused(phone)).toBe(true);
  });
});

describe("пауза между устройствами", () => {
  it("пауза доходит до другого устройства, возврат — тоже", async () => {
    const { phone, tablet } = await pair();
    await pauseCourse(COURSE, tick(), phone.db);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    expect(await paused(tablet)).toBe(true);
    await resumeCourse(COURSE, tick(), tablet.db);
    await tablet.sync.exchange();
    await phone.sync.exchange();
    expect(await paused(phone)).toBe(false);
    expect(await readPauses(phone.db)).toEqual(await readPauses(tablet.db));
  });
  it("пауза и более поздний возврат без сети на разных устройствах — побеждает позднее, в любом порядке обмена", async () => {
    for (const order of [
      ["phone", "tablet"],
      ["tablet", "phone"],
    ]) {
      cloud = memoryTransport();
      const devices = await pair();
      await pauseCourse(COURSE, new Date("2026-10-20T10:00:00Z"), devices.phone.db);
      await pauseCourse(COURSE, new Date("2026-10-20T10:02:00Z"), devices.tablet.db);
      await resumeCourse(COURSE, new Date("2026-10-20T10:05:00Z"), devices.tablet.db);
      const [first, second] = order.map((name) => devices[name as "phone" | "tablet"]);
      await first.sync.exchange();
      await second.sync.exchange();
      await first.sync.exchange();
      expect(await paused(devices.phone)).toBe(false);
      expect(await paused(devices.tablet)).toBe(false);
    }
  });
  it("отстающие часы: возврат после известной паузы всё равно побеждает", async () => {
    const { phone, tablet } = await pair();
    await pauseCourse(COURSE, new Date("2026-10-20T10:00:00Z"), tablet.db);
    await tablet.sync.exchange();
    await phone.sync.exchange();
    await resumeCourse(COURSE, new Date("2026-10-20T09:00:00Z"), phone.db);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    expect(await paused(tablet)).toBe(false);
    expect(await paused(phone)).toBe(false);
  });
  it("три устройства сходятся к одной записи", async () => {
    const { phone, tablet } = await pair();
    const laptop = await device("laptop");
    await laptop.sync.exchange();
    await pauseCourse(COURSE, new Date("2026-10-20T10:00:00Z"), phone.db);
    await pauseCourse("greek-a2", new Date("2026-10-20T10:01:00Z"), tablet.db);
    await pauseCourse(COURSE, new Date("2026-10-20T10:03:00Z"), laptop.db);
    await resumeCourse(COURSE, new Date("2026-10-20T10:04:00Z"), laptop.db);
    for (let round = 0; round < 2; round++)
      for (const dev of [phone, tablet, laptop]) expect((await dev.sync.exchange()).phase).toBe("synced");
    const expected = await readPauses(laptop.db);
    expect(expected[COURSE].pausedAt).toBeNull();
    expect(expected["greek-a2"].pausedAt).toBeTruthy();
    expect(await readPauses(phone.db)).toEqual(expected);
    expect(await readPauses(tablet.db)).toEqual(expected);
    const writes = cloud.log.filter((entry) => entry.startsWith("setItem cp_")).length;
    for (const dev of [phone, tablet, laptop]) await dev.sync.exchange();
    expect(cloud.log.filter((entry) => entry.startsWith("setItem cp_")).length).toBe(writes);
  });
  it("пауза на одном устройстве и ответы на другом — окна выбора нет, ответы целы", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true, true]);
    const answered = await cards(phone);
    await pauseCourse(COURSE, tick(), tablet.db);
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    const status = await phone.sync.exchange();
    expect(status.phase).toBe("synced");
    expect(status.conflict).toBeNull();
    expect(await cards(phone)).toBe(answered);
    expect(await paused(phone)).toBe(true);
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect(await cards(tablet)).toBe(answered);
  });
  it("одновременные пауза с ответами на одном и ответы на другом — обычный выбор версии, пауза его не касается", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true]);
    await study(tablet, [true]);
    await pauseCourse(COURSE, tick(), tablet.db);
    await phone.sync.exchange();
    const conflict = await tablet.sync.exchange();
    expect(conflict.conflict?.kind).toBe("diverged");
    expect(await paused(tablet)).toBe(true);
    await tablet.sync.resolve(conflict.conflict!.branches.find((branch) => !branch.local)!.id);
    expect(await paused(tablet)).toBe(true);
    await phone.sync.exchange();
    expect(await paused(phone)).toBe(true);
  });
  it("без блокировки вкладок паузы всё равно обмениваются", async () => {
    const { phone } = await pair();
    await pauseCourse(COURSE, tick(), phone.db);
    await phone.sync.exchange();
    const reader = await device("reader", { lock: async () => "unsupported" });
    await reader.sync.exchange();
    expect(await paused(reader)).toBe(true);
  });
  it("сбой записи ключа пауз не мешает прогрессу, повтор — при следующем обмене", async () => {
    let failing = true;
    const intercept: MemoryTransportOptions["intercept"] = (op, key) => {
      if (failing && op === "setItem" && key?.startsWith("cp_")) throw new SyncError("transport", "сбой");
    };
    cloud = memoryTransport({ intercept });
    const phone = await device("phone");
    await pauseCourse(COURSE, tick(), phone.db);
    await study(phone, [true, true]);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await pointer(phone)).toBeTruthy();
    expect(cloud.store.has(pausesKey(await phone.sync.deviceId()))).toBe(false);
    failing = false;
    await phone.sync.exchange();
    expect(cloud.store.has(pausesKey(await phone.sync.deviceId()))).toBe(true);
  });
  it("восстановленная копия без паузы получает паузу облака по времени", async () => {
    const { phone, tablet } = await pair();
    const copy = await exportFull(tablet.db);
    await pauseCourse(COURSE, tick(), phone.db);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    const parsed = JSON.parse(await copy.text());
    const blob = new Blob([JSON.stringify({ ...parsed, data: { ...parsed.data, databaseName: "tetradio" } })]);
    await restoreBackup(blob, tablet.db);
    expect(await paused(tablet)).toBe(false);
    await tablet.sync.exchange();
    expect(await paused(tablet)).toBe(true);
    await Dexie.delete("tetradio-restore");
  });
});
