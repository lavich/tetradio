import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { makeSession } from "../src/domain/learning";
import { PAUSES_MARK_KEY, readPauses } from "../src/storage/pauses";
import { pauseCourse, resumeCourse } from "../src/storage/pause-actions";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { applySnapshot, buildSnapshot, META, readMeta, readSnapshot, writeMeta } from "../src/sync/snapshot";
import { decodeSnapshot, encodeSnapshot } from "../src/sync/codec";
import { memoryTransport, type MemoryTransport } from "../src/sync/transport";
import { DECLARED_READS, SNAPSHOT_FORMAT, type CompactSnapshot } from "../src/sync/types";
import { buildAndCommit, submitAnswer } from "./helpers/ops";
import { installCompleted } from "./helpers/content";
import mainCloud from "./fixtures/sync-format5-main.json";
import pauseMain from "./fixtures/sync-pause-main.json";

const COURSE = "english";
let cloud: MemoryTransport;
let clockMs = Date.parse("2026-10-20T07:00:00Z");
const tick = (minutes = 1) => new Date((clockMs += minutes * 60000));
const now = () => new Date(clockMs);
let counter = 0;

async function device(name: string, lessons: string[] = ["mech-1"]) {
  const db = new AppDatabase(`tetradio-sync-pause-${name}-${++counter}`);
  await db.delete();
  await db.open();
  if (lessons.length) await installCompleted(db, lessons);
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(cloud),
    now,
    label: name,
    schedule: () => () => undefined,
    retryBaseMs: 1,
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
const states = (dev: Device) => dev.db.cardStates.count();
const pointerId = async (dev: Device) => {
  const raw = cloud.store.get(`p_${await dev.sync.deviceId()}`);
  return raw ? (JSON.parse(raw) as { id: string }).id : null;
};
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

describe("пауза в снимке", () => {
  const snapshotWith = (pauses?: CompactSnapshot["pauses"]): CompactSnapshot => ({
    ...(pauseMain.f6.decoded as CompactSnapshot),
    ...(pauses ? { pauses } : {}),
  });
  const pause = {
    courseId: COURSE,
    pausedAt: "2026-10-12T09:00:00.000Z",
    resumedAt: null,
    updatedAt: "2026-10-12T09:00:00.000Z",
  };
  it("круг кодека с паузами в форматах 5 и 6", () => {
    for (const format of [5, 6]) {
      const decoded = decodeSnapshot(encodeSnapshot(snapshotWith([pause]), format));
      expect(decoded.pauses).toEqual([pause]);
    }
  });
  it("без пауз ключа нет: текст снимка прежний", () => {
    for (const format of [5, 6] as const) {
      const text = encodeSnapshot(snapshotWith(), format);
      expect(text).not.toContain('"cp"');
      expect(decodeSnapshot(text).pauses).toBeUndefined();
      expect(encodeSnapshot(snapshotWith([]), format)).toBe(text);
    }
  });
  it("неразборная строка пауз пропускается, остальное применяется", () => {
    const wire = JSON.parse(encodeSnapshot(snapshotWith([pause]), 6));
    wire.cp.push(["broken"], [COURSE, "вчера", 0, 1], 7);
    const decoded = decodeSnapshot(JSON.stringify(wire), 6);
    expect(decoded.pauses).toEqual([pause]);
    expect(decoded.states).toHaveLength(1);
  });
  it("страж: разбор текста с паузами совпадает с результатом кодека main из фикстуры, кроме пауз", () => {
    for (const key of ["f5", "f6"] as const) {
      const { text, decoded } = pauseMain[key];
      const { pauses, ...rest } = decodeSnapshot(text);
      expect(pauses).toHaveLength(1);
      expect(rest).toEqual(decoded);
    }
  });
});

describe("слияние пауз при применении версии", () => {
  const base = async () => {
    const dev = await device("solo");
    return { dev, snapshot: await readSnapshot(dev.db, now()) };
  };
  const record = (pausedAt: string | null, updatedAt: string) => ({
    courseId: COURSE,
    pausedAt,
    resumedAt: pausedAt ? null : updatedAt,
    updatedAt,
  });
  it("запись версии новее заменяет, старше — нет; отметку пауз применение не ставит", async () => {
    const { dev, snapshot } = await base();
    await pauseCourse(COURSE, new Date("2026-10-12T09:00:00Z"), dev.db);
    await writeMeta(dev.db, PAUSES_MARK_KEY, null);
    await applySnapshot(
      dev.db,
      { ...snapshot, pauses: [record(null, "2026-10-13T09:00:00.000Z")] },
      "x-1",
      { x: 1 },
      now(),
    );
    expect(await paused(dev)).toBe(false);
    expect(await readMeta(dev.db, PAUSES_MARK_KEY)).toBeNull();
    await pauseCourse(COURSE, new Date("2026-10-14T09:00:00Z"), dev.db);
    await writeMeta(dev.db, PAUSES_MARK_KEY, null);
    await applySnapshot(
      dev.db,
      { ...snapshot, pauses: [record(null, "2026-10-13T09:00:00.000Z")] },
      "x-2",
      { x: 2 },
      now(),
    );
    expect(await paused(dev)).toBe(true);
    expect(await readMeta(dev.db, PAUSES_MARK_KEY)).toBeNull();
  });
  it("версия без пауз паузу не меняет и отдельной публикации не требует", async () => {
    const { dev, snapshot } = await base();
    await pauseCourse(COURSE, new Date("2026-10-12T09:00:00Z"), dev.db);
    await writeMeta(dev.db, PAUSES_MARK_KEY, null);
    await applySnapshot(dev.db, snapshot, "x-1", { x: 1 }, now());
    expect(await paused(dev)).toBe(true);
    expect(await readMeta(dev.db, PAUSES_MARK_KEY)).toBeNull();
  });
  it("равное время — одна и та же запись на обоих устройствах", async () => {
    const { dev, snapshot } = await base();
    const other = await device("other");
    const at = "2026-10-12T09:00:00.000Z";
    await applySnapshot(dev.db, { ...snapshot, pauses: [record(at, at)] }, "x-1", { x: 1 }, now());
    await applySnapshot(dev.db, { ...snapshot, pauses: [record(null, at)] }, "x-2", { x: 2 }, now());
    await applySnapshot(other.db, { ...snapshot, pauses: [record(null, at)] }, "x-1", { x: 1 }, now());
    await applySnapshot(other.db, { ...snapshot, pauses: [record(at, at)] }, "x-2", { x: 2 }, now());
    expect(await readPauses(dev.db)).toEqual(await readPauses(other.db));
  });
});

describe("пауза между устройствами", () => {
  it("пауза доходит до другого устройства без отметки неопубликованных изменений", async () => {
    const { phone, tablet } = await pair();
    await pauseCourse(COURSE, tick(), phone.db);
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await readMeta(phone.db, PAUSES_MARK_KEY)).toBeNull();
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect(await readPauses(tablet.db)).toEqual(await readPauses(phone.db));
  });
  it("пауза на отставшем устройстве и ответы на другом — окна выбора нет, ответы и пауза на обоих", async () => {
    const { phone, tablet } = await pair();
    await study(tablet, [false, true, true]);
    await tablet.sync.exchange();
    await pauseCourse(COURSE, tick(), phone.db);
    const status = await phone.sync.exchange();
    expect(status.phase).toBe("synced");
    expect(await states(phone)).toBe(await states(tablet));
    expect(await phone.db.cardStates.toArray()).toEqual(await tablet.db.cardStates.toArray());
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect(await paused(tablet)).toBe(true);
    const ids = [await pointerId(phone), await pointerId(tablet)];
    await phone.sync.exchange();
    await tablet.sync.exchange();
    expect([await pointerId(phone), await pointerId(tablet)]).toEqual(ids);
  });
  it("новое устройство с паузой до первого обмена — не расхождение, пауза опубликована", async () => {
    const phone = await device("phone");
    await study(phone, [true, true]);
    await phone.sync.exchange();
    const tablet = await device("tablet");
    await pauseCourse(COURSE, tick(), tablet.db);
    const status = await tablet.sync.exchange();
    expect(status.phase).toBe("synced");
    expect(status.conflict).toBeNull();
    expect(await states(tablet)).toBe(await states(phone));
    await phone.sync.exchange();
    expect(await paused(phone)).toBe(true);
  });
  it("пауза и более поздний возврат на разных устройствах — курс идёт на обоих", async () => {
    const { phone, tablet } = await pair();
    await pauseCourse(COURSE, new Date("2026-10-20T10:00:00Z"), phone.db);
    await pauseCourse(COURSE, new Date("2026-10-20T10:02:00Z"), tablet.db);
    await resumeCourse(COURSE, new Date("2026-10-20T10:05:00Z"), tablet.db);
    await phone.sync.exchange();
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    await phone.sync.exchange();
    expect(await paused(phone)).toBe(false);
    expect(await paused(tablet)).toBe(false);
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
  it("формат версии и объявленные форматы не меняются", async () => {
    const { phone } = await pair();
    await pauseCourse(COURSE, tick(), phone.db);
    await phone.sync.exchange();
    const pointer = JSON.parse(cloud.store.get(`p_${await phone.sync.deviceId()}`)!);
    expect(pointer.reads).toEqual(DECLARED_READS);
    expect(pointer.format).toBe(SNAPSHOT_FORMAT);
  });
  it("версия прежней сборки без пауз: пауза остаётся, публикуется одна версия", async () => {
    for (const [key, value] of Object.entries(mainCloud.cloud)) cloud.store.set(key, value);
    const fresh = await device("fresh");
    await pauseCourse(COURSE, tick(), fresh.db);
    expect((await fresh.sync.exchange()).phase).toBe("synced");
    expect(await fresh.db.cardStates.count()).toBe(mainCloud.snapshot.states.length);
    expect(await paused(fresh)).toBe(true);
    const id = await pointerId(fresh);
    expect(id).not.toBeNull();
    const [pointer] = (await kvAdapter(cloud).listPointers()).pointers.filter((item) => item.id === id);
    expect((await kvAdapter(cloud).readVersion(pointer)).pauses?.[0].courseId).toBe(COURSE);
    await fresh.sync.exchange();
    expect(await pointerId(fresh)).toBe(id);
  });
});

describe("пауза другого устройства и свои неотправленные ответы", () => {
  it("пауза на другом устройстве при своих неотправленных ответах — окна выбора нет, ответы и пауза сохранены", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true, true]);
    const answered = await phone.db.cardStates.toArray();
    await pauseCourse(COURSE, tick(), tablet.db);
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    const status = await phone.sync.exchange();
    expect(status.phase).toBe("synced");
    expect(status.conflict).toBeNull();
    expect(await phone.db.cardStates.toArray()).toEqual(answered);
    expect(await paused(phone)).toBe(true);
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    expect(await tablet.db.cardStates.toArray()).toEqual(answered);
    expect(await paused(tablet)).toBe(true);
  });
  it("публикация только паузы помечена часами применённой версии, обычная — нет", async () => {
    const { phone, tablet } = await pair();
    await pauseCourse(COURSE, tick(), tablet.db);
    await tablet.sync.exchange();
    const pointer = JSON.parse(cloud.store.get(`p_${await tablet.sync.deviceId()}`)!);
    expect(pointer.pausesOver).toEqual(JSON.parse((await readMeta(phone.db, META.clock))!));
    await study(tablet, [true]);
    await tablet.sync.exchange();
    expect(JSON.parse(cloud.store.get(`p_${await tablet.sync.deviceId()}`)!).pausesOver).toBeUndefined();
  });
  it("версия без пауз на устройстве с более новой паузой не вызывает отдельной публикации", async () => {
    const { phone, tablet } = await pair();
    await pauseCourse(COURSE, tick(), phone.db);
    await phone.sync.exchange();
    await tablet.db.meta.delete("coursePauses");
    await study(tablet, [true]);
    await tablet.sync.exchange();
    const before = await pointerId(phone);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await pointerId(phone)).toBe(before);
    expect(await paused(phone)).toBe(true);
    await study(phone, [true]);
    await phone.sync.exchange();
    await tablet.sync.exchange();
    expect(await paused(tablet)).toBe(true);
  });
  it("без записи в облако неопубликованная пауза не показывается синхронизированной", async () => {
    const phone = await device("phone");
    await study(phone, [true]);
    await phone.sync.exchange();
    const reader = await device("reader");
    const readOnly = new SyncCoordinator({
      database: reader.db,
      adapter: kvAdapter(cloud),
      now,
      label: "reader",
      schedule: () => () => undefined,
      retryBaseMs: 1,
      lock: async () => "unsupported",
    });
    await pauseCourse(COURSE, tick(), reader.db);
    const status = await readOnly.exchange();
    expect(status.dirty).toBe(true);
  });
});

describe("окно выбора не теряет более позднюю паузу", () => {
  it("расхождение, выбор версии другого устройства: своя более поздняя пауза сохраняется", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true]);
    await phone.sync.exchange();
    await study(tablet, [true]);
    await pauseCourse(COURSE, tick(), tablet.db);
    const conflict = await tablet.sync.exchange();
    expect(conflict.conflict?.kind).toBe("diverged");
    await tablet.sync.resolve(conflict.conflict!.branches.find((branch) => !branch.local)!.id);
    expect(await paused(tablet)).toBe(true);
    await phone.sync.exchange();
    expect(await paused(phone)).toBe(true);
  });
  it("расхождение, выбор своей версии: более поздняя пауза другой ветви сохраняется", async () => {
    const { phone, tablet } = await pair();
    await study(phone, [false, true]);
    await pauseCourse(COURSE, tick(), phone.db);
    await phone.sync.exchange();
    await study(tablet, [true]);
    const conflict = await tablet.sync.exchange();
    expect(conflict.conflict?.kind).toBe("diverged");
    await tablet.sync.resolve(conflict.conflict!.branches.find((branch) => branch.local)!.id);
    expect(await paused(tablet)).toBe(true);
    await phone.sync.exchange();
    expect(await paused(phone)).toBe(true);
  });
  it("восстановленная копия: пауза облака сохраняется при выборе копии", async () => {
    const { phone, tablet } = await pair();
    await pauseCourse(COURSE, tick(), phone.db);
    await phone.sync.exchange();
    await writeMeta(tablet.db, META.restored, now().toISOString());
    const conflict = await tablet.sync.exchange();
    expect(conflict.conflict?.kind).toBe("restored");
    await tablet.sync.resolve(conflict.conflict!.branches.find((branch) => branch.local)!.id);
    expect(await paused(tablet)).toBe(true);
  });
  it("несколько версий облака: пауза невыбранной ветви сохраняется", async () => {
    const { phone, tablet } = await pair();
    const clean = await device("clean");
    await clean.sync.exchange();
    await study(phone, [true]);
    await pauseCourse(COURSE, tick(), phone.db);
    await study(tablet, [false]);
    await phone.sync.exchange();
    const adapter = kvAdapter(cloud);
    const tabletDevice = await tablet.sync.deviceId();
    const snapshot = await buildAndCommit(tablet.db, now(), `${tabletDevice}-1`);
    const tabletClock = JSON.parse((await readMeta(tablet.db, META.clock))!);
    await adapter.publishVersion(
      {
        id: `${tabletDevice}-1`,
        device: tabletDevice,
        clock: { ...tabletClock, [tabletDevice]: 1 },
        createdAt: now().toISOString(),
        format: SNAPSHOT_FORMAT,
        resolves: [],
      },
      snapshot,
    );
    const conflict = await clean.sync.exchange();
    expect(conflict.conflict?.kind).toBe("remote");
    const tabletBranch = conflict.conflict!.branches.find((branch) => branch.device === tabletDevice)!;
    await clean.sync.resolve(tabletBranch.id);
    expect(await paused(clean)).toBe(true);
  });
});

it("страж: снимок без пауз собирается без ключа пауз", async () => {
  const dev = await device("plain");
  const snapshot = await dev.db.transaction("r", dev.db.tables, () => buildSnapshot(dev.db, now()));
  expect("pauses" in snapshot).toBe(false);
});
