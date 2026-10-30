// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { submitAnswer } from "./helpers/ops";
import { makeSession } from "../src/domain/learning";
import { progress } from "../src/domain/stats";
import { kvAdapter } from "../src/sync/adapter";
import { readChain } from "../src/sync/ancestors";
import { SyncCoordinator } from "../src/sync/coordinator";
import { memoryTransport, SyncError, type KeyValueTransport, type MemoryTransport } from "../src/sync/transport";
import { META, progressOf, readMeta, readSnapshot } from "../src/sync/snapshot";
import { normalize } from "../src/sync/merge";
import { markChanged } from "../src/storage/ops";
import { installCompleted } from "./helpers/content";
import { exportFull, restoreBackup } from "../src/features/backup/backup";
import { forgetAncestors } from "./helpers/sync";
import { loadBuild, ROLLBACK_BUILD } from "./helpers/builds";

let cloud: MemoryTransport;
let clockMs = Date.parse("2026-09-16T08:00:00Z");
const tick = (minutes = 1) => {
  clockMs += minutes * 60000;
  return new Date(clockMs);
};
const now = () => new Date(clockMs);
let counter = 0;

/** Вид облака для одного устройства: скрытые указатели других устройств — «ещё не увидело их публикацию». */
function view(hidden: Set<string>): KeyValueTransport {
  return {
    ...cloud,
    async getKeys() {
      return (await cloud.getKeys()).filter((key) => !hidden.has(key));
    },
    async getItems(keys) {
      return cloud.getItems(keys.filter((key) => !hidden.has(key)));
    },
    setItem: (key, value) => cloud.setItem(key, value),
    removeItems: (keys) => cloud.removeItems(keys),
  };
}
async function device(name: string) {
  const db = new AppDatabase(`tetradio-merge-${name}-${++counter}`);
  await db.delete();
  await db.open();
  await installCompleted(db, ["mech-1"]);
  const hidden = new Set<string>();
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(view(hidden)),
    now,
    label: name,
    schedule: () => () => undefined,
    retryBaseMs: 1,
  });
  return { name, db, sync, hidden, given: 0 };
}
type Device = Awaited<ReturnType<typeof device>>;
async function study(dev: Device, count = 2, mode: "scheduled" | "practice" = "scheduled") {
  const source = dexieSource(dev.db);
  const session = await makeSession({
    source,
    now: tick(),
    random: () => 0.31,
    mode,
    ...(mode === "practice" && { refs: (await dev.db.cardStates.toArray()).map((state) => state.ref) }),
  });
  await dev.db.sessions.add(session);
  const items = session.items.filter((item) => !item.eventId).slice(0, count);
  for (const item of items) {
    await submitAnswer({
      session,
      item,
      correct: true,
      answer: "",
      responseTimeMs: 900,
      activeTimeMs: 900,
      timezone: "Asia/Nicosia",
      now: tick(),
      database: dev.db,
    });
    dev.given++;
  }
}
const answers = async (dev: Device) => (await progress(dexieSource(dev.db), now())).totals.answers;
const pointer = async (dev: Device) => `p_${await dev.sync.deviceId()}`;
/** Устройство публикует, не увидев свежую версию другого: «почти одновременно». */
async function blind(dev: Device, other: Device) {
  dev.hidden.add(await pointer(other));
  const status = await dev.sync.exchange();
  dev.hidden.clear();
  return status;
}
function failNext(match: (key: string) => boolean, ackLost = false) {
  const original = cloud.setItem.bind(cloud);
  let armed = true;
  cloud.setItem = async (key, value) => {
    if (armed && match(key)) {
      armed = false;
      if (ackLost) await original(key, value);
      throw new SyncError("transport", "Telegram CloudStorage не ответил за 15 с.");
    }
    await original(key, value);
  };
}
async function pair() {
  const phone = await device("phone");
  const mac = await device("mac");
  await study(phone, 3);
  expect((await phone.sync.exchange()).phase).toBe("synced");
  expect((await mac.sync.exchange()).phase).toBe("synced");
  return { phone, mac };
}
async function settle(...devices: Device[]) {
  for (let round = 0; round < 4; round++)
    for (const dev of devices) {
      const status = await dev.sync.exchange();
      expect(status.conflict, `${dev.name}: окно выбора`).toBeNull();
    }
  const contents = await Promise.all(
    devices.map(async (dev) => progressOf(normalize(await readSnapshot(dev.db, now())))),
  );
  expect(new Set(contents).size).toBe(1);
}
const total = (...devices: Device[]) => devices.reduce((sum, dev) => sum + dev.given, 0);

beforeEach(() => {
  cloud = memoryTransport();
  clockMs = Date.parse("2026-09-16T08:00:00Z");
});

describe("автоматическое слияние", () => {
  it("занятия на двух устройствах офлайн: окна нет, обе стороны видят все ответы", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    await study(mac, 3);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    const status = await phone.sync.exchange();
    expect(status.conflict).toBeNull();
    expect(status.phase).toBe("synced");
    await settle(mac, phone);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
  });

  it("почти одновременная публикация: чистое устройство сливает свою версию с чужой", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    await study(mac, 2);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await blind(mac, phone)).phase).toBe("synced");
    await settle(phone, mac);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
  });

  it("потерянный ответ облака и слияние: статистика не удваивается", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    failNext((key) => key.startsWith("p_"), true);
    expect((await phone.sync.exchange()).phase).toBe("error");
    await study(mac, 2);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await study(phone, 1);
    await settle(phone, mac);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
  });

  it("сбой между применением слияния и публикацией: ответы не теряются, новая версия облака сливается от опоры", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    await study(mac, 2);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    failNext((key) => key.startsWith("v_"));
    expect((await phone.sync.exchange()).phase).toBe("error");
    expect(await readMeta(phone.db, META.dirty)).not.toBeNull();
    await study(mac, 1);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await settle(phone, mac);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
  });

  it("ответы практики обеих сторон входят в итог", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2, "practice");
    await study(mac, 2);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await settle(phone, mac);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
  });

  it("одновременное слияние на двух устройствах сходится без окна и без лишних публикаций", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    await study(mac, 2);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await blind(mac, phone)).phase).toBe("synced");
    await Promise.all([phone.sync.exchange(), mac.sync.exchange()]);
    const writes = cloud.log.filter((entry) => entry.startsWith("setItem p_")).length;
    await settle(phone, mac);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
    const later = cloud.log.filter((entry) => entry.startsWith("setItem p_")).length;
    expect(later - writes).toBeLessThanOrEqual(2);
    await settle(phone, mac);
    expect(cloud.log.filter((entry) => entry.startsWith("setItem p_")).length).toBe(later);
  });

  it("три устройства: наблюдатель без своих ответов не сливает, а применяет результат", async () => {
    const { phone, mac } = await pair();
    const tablet = await device("tablet");
    expect((await tablet.sync.exchange()).phase).toBe("synced");
    await study(phone, 2);
    await study(mac, 2);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await blind(mac, phone)).phase).toBe("synced");
    const published = cloud.log.filter((entry) => entry.startsWith("setItem p_")).length;
    const observer = await tablet.sync.exchange();
    expect(observer.conflict).toBeNull();
    expect(cloud.log.filter((entry) => entry.startsWith("setItem p_")).length).toBe(published);
    await settle(phone, mac, tablet);
    expect(await answers(tablet)).toBe(total(phone, mac, tablet));
  });

  it("цепочка ограничена: долгая серия публикаций при застывшем чужом указателе", async () => {
    const { phone, mac } = await pair();
    for (let index = 0; index < 8; index++) {
      await study(phone, 1);
      expect((await phone.sync.exchange()).phase).toBe("synced");
    }
    const chain = await readChain(phone.db);
    expect(chain.filter((link) => link.own).length).toBeLessThanOrEqual(3);
    expect(chain.filter((link) => !link.own).length).toBeLessThanOrEqual(2);
    const keys = (await phone.db.meta.toCollection().primaryKeys()) as string[];
    expect(keys.filter((key) => key.startsWith("sync:ancestor:")).length).toBe(chain.length);
    await study(mac, 1);
    await settle(mac, phone);
    expect(await answers(mac)).toBe(total(phone, mac));
  });

  it("без общего предка — окно выбора, как раньше", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    await study(mac, 2);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await forgetAncestors(phone.db);
    const status = await phone.sync.exchange();
    expect(status.conflict?.kind).toBe("diverged");
  });

  it("восстановленная копия — окно выбора: у неё нет общего предка с облаком", async () => {
    const { phone, mac } = await pair();
    const copy = JSON.parse(await (await exportFull(phone.db)).text());
    const blob = new Blob([JSON.stringify({ ...copy, data: { ...copy.data, databaseName: "tetradio" } })]);
    await study(phone, 2);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    await study(mac, 1);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await restoreBackup(blob, phone.db);
    expect(await readChain(phone.db)).toEqual([]);
    expect((await phone.sync.exchange()).conflict?.kind).toBe("restored");
  });

  it("снимок до слияния хранится одной строкой «До объединения»", async () => {
    const { phone, mac } = await pair();
    for (let round = 0; round < 2; round++) {
      await study(phone, 1);
      await study(mac, 1);
      expect((await mac.sync.exchange()).phase).toBe("synced");
      await settle(phone, mac);
    }
    const rows = await phone.db.syncVersions.toArray();
    expect(rows.filter((row) => row.note === "До объединения")).toHaveLength(1);
  });

  it("выбор в окне распространяется как удаление: ответы отвергнутой ветви уходят, новые ответы остаются", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    await study(mac, 1);
    await forgetAncestors(mac.db);
    const window = await mac.sync.exchange();
    expect(window.conflict?.kind).toBe("diverged");
    await mac.sync.resolve(window.conflict!.branches.find((branch) => branch.local)!.id);
    await study(phone, 1);
    await settle(phone, mac);
    expect(await answers(phone)).toBe(5);
    expect(await answers(mac)).toBe(5);
  });

  it("звено, указатель которого убрала уборка, подтверждается по часам другого устройства: без удвоения", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    failNext((key) => key.startsWith("p_"), true);
    expect((await phone.sync.exchange()).phase).toBe("error");
    expect((await mac.sync.exchange()).phase).toBe("synced");
    cloud.store.delete(await pointer(phone));
    await study(phone, 1);
    await study(mac, 2);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await settle(phone, mac);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
  });

  it("эмуляция сборки отката (код ветки с её константами формата): отложенные версии читаются, цепочка в служебных ключах не мешает", async () => {
    const { phone, mac } = await pair();
    await study(phone, 1);
    await study(mac, 1);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await settle(phone, mac);
    expect((await readChain(phone.db)).length).toBeGreaterThan(0);
    const legacy = await loadBuild(ROLLBACK_BUILD);
    const old = new legacy.SyncCoordinator({
      database: phone.db,
      adapter: legacy.kvAdapter(cloud),
      now,
      schedule: () => () => undefined,
    });
    const stored = await old.listStored();
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) expect(Array.isArray(row.snapshot.states)).toBe(true);
    expect((await old.exchange()).phase).toBe("synced");
  });

  it("почти одновременная публикация, сбой записи объединения на телефоне, компьютер объединил то же — окна нет", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    await study(mac, 2);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await blind(mac, phone)).phase).toBe("synced");
    failNext((key) => key.startsWith("v_"));
    expect((await phone.sync.exchange()).phase).toBe("error");
    expect((await mac.sync.exchange()).phase).toBe("synced");
    await settle(phone, mac);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
  });

  it("ответ во время каждого чтения перед объединением: окна нет, отметка остаётся, следующий обмен объединяет", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    await study(mac, 2);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    const answer = () => void Dexie.ignoreTransaction(() => markChanged(phone.db));
    phone.db.syncVersions.hook("creating", answer);
    const busy = await phone.sync.exchange();
    phone.db.syncVersions.hook("creating").unsubscribe(answer);
    expect(busy.conflict).toBeNull();
    expect(await readMeta(phone.db, META.dirty)).not.toBeNull();
    await settle(phone, mac);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
  });

  it("компьютер раз за разом публикует поверх только что опубликованного объединения — окна нет, ответы обеих сторон на месте", async () => {
    const { phone, mac } = await pair();
    await study(phone, 2);
    await study(mac, 2);
    expect((await mac.sync.exchange()).phase).toBe("synced");
    const phonePointer = await pointer(phone);
    const original = cloud.setItem.bind(cloud);
    let raced = 0;
    cloud.setItem = async (key, value) => {
      await original(key, value);
      if (raced < 4 && key === phonePointer) {
        raced++;
        await study(mac, 1);
        mac.hidden.add(phonePointer);
        await mac.sync.exchange();
        mac.hidden.clear();
      }
    };
    const status = await phone.sync.exchange();
    cloud.setItem = original;
    expect(raced).toBeGreaterThan(1);
    expect(status.conflict).toBeNull();
    await settle(phone, mac);
    expect(await answers(phone)).toBe(total(phone, mac));
    expect(await answers(mac)).toBe(total(phone, mac));
    expect(await phone.db.cardStates.toArray()).toEqual(await mac.db.cardStates.toArray());
  });
});
