import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { installLesson } from "../src/content/client";
import { makeSession } from "../src/domain/learning";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { blockProgressOf, completeLesson, saveBlockProgress } from "../src/storage/course";
import { saveSettings, settleLessons, submitAnswer } from "../src/storage/ops";
import { defaultSettings } from "../src/domain/types";
import type { TelegramCloudStorage } from "../src/platform/telegram-types";
import { kvAdapter } from "../src/sync/adapter";
import { decodeSnapshot, encodeSnapshot } from "../src/sync/codec";
import { SyncCoordinator } from "../src/sync/coordinator";
import { syncEvents } from "../src/sync/events";
import {
  applySnapshot,
  buildAndCommit,
  buildSnapshot,
  describeSnapshot,
  META,
  readMeta,
  readPending,
} from "../src/sync/snapshot";
import { cloudStorageTransport, memoryTransport, type MemoryTransport } from "../src/sync/transport";
import { SNAPSHOT_FORMAT } from "../src/sync/types";
import { installLessons, memoryFetcher } from "./helpers/content";

const demo = buildContent("tests/fixtures/course-demo");
const fetcher = () => memoryFetcher(demo);
const TASKS = ["forms", "anna-tf", "cafe-q", "about-me", "intro"];

let cloud: MemoryTransport;
let clockMs = Date.parse("2026-09-16T08:00:00Z");
const tick = (minutes = 1) => {
  clockMs += minutes * 60000;
  return new Date(clockMs);
};
const now = () => new Date(clockMs);
let counter = 0;
interface DeviceOptions {
  lessons?: string[];
  transport?: Parameters<typeof kvAdapter>[0];
  scheduled?: { run: () => void; cancelled: boolean }[];
}
async function device(name: string, { lessons = ["m01-1"], transport, scheduled }: DeviceOptions = {}) {
  const db = new AppDatabase(`tetradio-course-sync-${name}-${++counter}`);
  await db.delete();
  await db.open();
  await installLessons(db, lessons, fetcher());
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(transport ?? cloud),
    now,
    label: name,
    schedule: (run) => {
      const entry = { run, cancelled: false };
      scheduled?.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    retryBaseMs: 1,
  });
  return { db, sync, name };
}
type Device = Awaited<ReturnType<typeof device>>;
async function finishLesson(dev: Device) {
  await saveBlockProgress(
    "m01-1",
    "forms",
    { done: true, answers: { q1: "είμαι", q2: "είσαι" }, score: { correct: 2, almost: 0, total: 2 } },
    dev.db,
  );
  await saveBlockProgress(
    "m01-1",
    "anna-tf",
    { done: true, answers: { q1: "Σωστό" }, score: { correct: 1, almost: 0, total: 2 } },
    dev.db,
  );
  await saveBlockProgress(
    "m01-1",
    "cafe-q",
    { done: true, answers: { q1: "Μαρια" }, score: { correct: 1, almost: 1, total: 2 } },
    dev.db,
  );
  await saveBlockProgress("m01-1", "about-me", { done: true, text: "Με λένε Ιβάν.", checks: [0, 2] }, dev.db);
  await saveBlockProgress("m01-1", "intro", { done: true, checks: [1] }, dev.db);
  await completeLesson("m01-1", dev.db);
}
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
  return items.length;
}
const rows = async (dev: Device) =>
  (await dev.db.blockProgress.orderBy("key").toArray()).map(({ answers: _a, text: _t, ...row }) => row);
const pointers = (store: Map<string, string>) => [...store.keys()].filter((key) => key.startsWith("p_"));

beforeEach(() => {
  cloud = memoryTransport();
  clockMs = Date.parse("2026-09-16T08:00:00Z");
});

describe("снимок формата 3: прогресс курса", () => {
  it("несёт блоки, критерии, счёт и завершение урока, но не ответы и не текст письма", async () => {
    const phone = await device("phone");
    await finishLesson(phone);
    const snapshot = await buildAndCommit(phone.db, now(), "dev-1");
    expect(snapshot.format).toBe(SNAPSHOT_FORMAT);
    expect(SNAPSHOT_FORMAT).toBe(3);
    expect(snapshot.blocks.map((block) => block.blockId).sort()).toEqual([...TASKS].sort());
    expect(snapshot.blocks.find((block) => block.blockId === "cafe-q")).toMatchObject({
      done: true,
      score: { correct: 1, almost: 1, total: 2 },
    });
    expect(snapshot.blocks.find((block) => block.blockId === "about-me")).toMatchObject({ checks: [0, 2] });
    expect(snapshot.lessons.find((lesson) => lesson.id === "m01-1")).toMatchObject({ status: "completed" });
    const wire = encodeSnapshot(snapshot);
    expect(decodeSnapshot(wire)).toEqual(snapshot);
    for (const secret of ["είμαι", "Σωστό", "Μαρια", "Με λένε"]) expect(wire).not.toContain(secret);
    expect(describeSnapshot(snapshot)).toMatchObject({ courseLessons: 1, blocks: 5 });
  });
  it("снимок формата 2 читается без блоков и не стирает локальный прогресс курса", async () => {
    const phone = await device("phone");
    await finishLesson(phone);
    const snapshot = await buildAndCommit(phone.db, now(), "dev-1");
    const wire = JSON.parse(encodeSnapshot(snapshot));
    delete wire.b;
    wire.f = 2;
    const older = decodeSnapshot(JSON.stringify(wire));
    expect(older.blocks).toEqual([]);
    const before = await rows(phone);
    expect(await applySnapshot(phone.db, older, "old-1", { other: 1 }, now(), 2)).toBe(true);
    expect(await rows(phone)).toEqual(before);
    // А формат 3 без блоков — повреждённый снимок, а не «нет прогресса».
    expect(() => decodeSnapshot(JSON.stringify({ ...wire, f: 3 }))).toThrow();
  });
  it("ответы и текст остаются у той же попытки, уходят у более новой и вместе с блоком, которого нет в версии", async () => {
    const phone = await device("phone");
    await finishLesson(phone);
    const snapshot = await buildAndCommit(phone.db, now(), "dev-1");
    const local = await blockProgressOf("m01-1", phone.db);
    const later = new Date(Date.parse(local.get("forms")!.updatedAt) + 60000).toISOString();
    const remote = {
      ...snapshot,
      blocks: snapshot.blocks
        .filter((block) => block.blockId !== "intro")
        .map((block) =>
          block.blockId === "forms"
            ? { ...block, updatedAt: later, score: { correct: 1, almost: 0, total: 2 } }
            : block.blockId === "about-me"
              ? { ...block, done: false }
              : block,
        ),
    };
    await applySnapshot(phone.db, remote, "other-1", { other: 1 }, now());
    const after = await blockProgressOf("m01-1", phone.db);
    expect(after.get("anna-tf")).toMatchObject({ answers: { q1: "Σωστό" }, score: { correct: 1, total: 2 } });
    // Отметка «не выполнено» той же записи применяется, а черновик письма остаётся.
    expect(after.get("about-me")).toMatchObject({ done: false, text: "Με λένε Ιβάν." });
    expect(after.get("forms")).toMatchObject({ done: true, score: { correct: 1, total: 2 }, updatedAt: later });
    expect(after.get("forms")!.answers).toBeUndefined();
    expect(after.has("intro")).toBe(false);
  });
});

describe("обмен прогрессом курса между устройствами", () => {
  it("B получает выполненные блоки и завершённый урок A; локальные ответы A остаются на A", async () => {
    const phone = await device("phone");
    const desktop = await device("desktop");
    await finishLesson(phone);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    expect((await desktop.sync.exchange()).phase).toBe("synced");
    expect(await rows(desktop)).toEqual(await rows(phone));
    expect((await desktop.db.lessons.get("m01-1"))?.status).toBe("completed");
    expect((await desktop.db.blockProgress.toArray()).every((row) => !row.answers && !row.text)).toBe(true);
    expect((await blockProgressOf("m01-1", phone.db)).get("forms")?.answers).toEqual({ q1: "είμαι", q2: "είσαι" });
    // Обратно: B ничего не менял — A применяет ту же версию, его ответы не стираются.
    await saveSettings({ ...defaultSettings, sessionSize: 7 }, desktop.db);
    expect((await desktop.sync.exchange()).phase).toBe("synced");
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect((await phone.db.settings.get("settings"))?.sessionSize).toBe(7);
    expect((await blockProgressOf("m01-1", phone.db)).get("forms")?.answers).toEqual({ q1: "είμαι", q2: "είσαι" });
  });
  it("прогресс неустановленного урока ждёт установки и не теряется при публикации с этого устройства", async () => {
    const phone = await device("phone");
    const fresh = await device("fresh", { lessons: [] });
    await finishLesson(phone);
    await phone.sync.exchange();
    expect((await fresh.sync.exchange()).phase).toBe("synced");
    expect(Object.keys(await readPending(fresh.db))).toContain("m01-1");
    expect((await fresh.db.blockProgress.count()) > 0).toBe(true);
    // Своя публикация с устройства без урока сохраняет его завершение и блоки для третьего устройства.
    await saveSettings({ ...defaultSettings, sessionSize: 9 }, fresh.db);
    expect((await fresh.sync.exchange()).phase).toBe("synced");
    const third = await device("third");
    expect((await third.sync.exchange()).phase).toBe("synced");
    expect((await third.db.lessons.get("m01-1"))?.status).toBe("completed");
    expect(await rows(third)).toEqual(await rows(phone));
    await installLesson("m01-1", fresh.db, fetcher());
    expect((await fresh.db.lessons.get("m01-1"))?.status).toBe("completed");
    expect((await blockProgressOf("m01-1", fresh.db)).get("cafe-q")?.done).toBe(true);
  });
  it("первое подключение устройства с прогрессом курса к непустому облаку требует выбора, а не стирает его", async () => {
    const phone = await device("phone");
    const desktop = await device("desktop");
    await saveSettings({ ...defaultSettings, sessionSize: 5 }, phone.db);
    await phone.sync.exchange();
    await saveBlockProgress("m01-1", "forms", { done: true, score: { correct: 2, almost: 0, total: 2 } }, desktop.db);
    const status = await desktop.sync.exchange();
    expect(status.phase).toBe("conflict");
    expect(status.conflict?.kind).toBe("initial");
    expect(status.conflict?.branches.find((branch) => branch.local)?.description.blocks).toBe(1);
  });
});

describe("даты расписания и уроки курса", () => {
  it("прошедший день расписания не завершает урок курса — только выполненные задания", async () => {
    const phone = await device("phone", { lessons: ["m01-1", "m01-test"] });
    await phone.db.courses.toCollection().modify((course) => {
      course.subscribed = true;
      course.schedule = { startDate: "2026-01-05", weekdays: [1, 2, 3, 4, 5, 6, 0], lessonHour: 12 };
    });
    // Свой набор того же расписания по-прежнему закрепляется датой: проверка не выключает правило целиком.
    await phone.db.lessons.add({
      id: "own-1",
      courseId: (await phone.db.courses.toArray())[0].id,
      title: "Свой",
      targetDate: "2026-01-06",
      status: "upcoming",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await settleLessons(new Date("2026-12-31T12:00:00Z"), phone.db);
    expect((await phone.db.lessons.get("m01-1"))?.status).toBe("upcoming");
    expect((await phone.db.lessons.get("m01-test"))?.status).toBe("upcoming");
    expect((await phone.db.lessons.get("own-1"))?.status).toBe("completed");
  });
});

describe("доставка: событие изменения, тайм-аут, гонка выгрузки, смена аккаунта", () => {
  it("выполнение блока и завершение урока сообщают об изменении — обмен планируется", async () => {
    const phone = await device("phone");
    const events: string[] = [];
    const off = syncEvents.on((event) => events.push(event));
    try {
      await saveBlockProgress("m01-1", "forms", { done: true }, phone.db);
      for (const blockId of TASKS.slice(1)) await saveBlockProgress("m01-1", blockId, { done: true }, phone.db);
      const before = events.length;
      await completeLesson("m01-1", phone.db);
      expect(events.length).toBe(before + 1);
      await completeLesson("m01-1", phone.db); // уже завершён — не изменение
      expect(events.length).toBe(before + 1);
    } finally {
      off();
    }
    expect(events.every((event) => event === "changed")).toBe(true);
    expect(events.length).toBe(TASKS.length + 1);
  });

  it("зависший CloudStorage даёт повторяемую ошибку по тайм-ауту; повтор публикует ту же версию без удвоения", async () => {
    let hang = true;
    const storage = fakeCloudStorage(cloud, (op, key) => hang && op === "setItem" && key.startsWith("p_"));
    const scheduled: { run: () => void; cancelled: boolean }[] = [];
    const phone = await device("phone", {
      transport: cloudStorageTransport(storage, { timeoutMs: 20 }),
      scheduled,
    });
    const answered = await study(phone, [true, false, true]);
    await finishLesson(phone);
    const first = await phone.sync.exchange();
    expect(first.phase).toBe("error");
    expect(first.error?.kind).toBe("transport");
    expect(await readMeta(phone.db, META.dirty)).toBeTruthy();
    expect(scheduled.filter((entry) => !entry.cancelled)).toHaveLength(1);
    // Запись дошла, а ответ потерялся: в облаке уже есть указатель той же версии.
    expect(pointers(cloud.store)).toHaveLength(1);
    const keysBefore = cloud.store.size;
    hang = false;
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(cloud.store.size).toBe(keysBefore);
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    const desktop = await device("desktop");
    await desktop.sync.exchange();
    const [onPhone, onDesktop] = await Promise.all([
      phone.db.transaction("r", phone.db.tables, () => buildSnapshot(phone.db, now())),
      desktop.db.transaction("r", desktop.db.tables, () => buildSnapshot(desktop.db, now())),
    ]);
    expect(onPhone.stats.answers).toBe(answered);
    expect(onDesktop.stats.answers).toBe(answered);
    expect(onDesktop.blocks).toEqual(onPhone.blocks);
  });

  it("изменение во время выгрузки остаётся неопубликованным и уходит следующим заходом", async () => {
    let phone: Device | null = null;
    let during = false,
      failNext = false;
    const transport = memoryTransport({
      intercept: async (op, key) => {
        if (op !== "setItem" || !key) return;
        if (failNext && key.startsWith("v_")) {
          failNext = false;
          throw new Error("сеть пропала");
        }
        if (during && key.startsWith("p_")) {
          during = false;
          failNext = true; // второй заход в том же обмене обрывается: остаётся только отметка
          await saveBlockProgress(
            "m01-1",
            "cafe-q",
            { done: true, score: { correct: 2, almost: 0, total: 2 } },
            phone!.db,
          );
        }
      },
    });
    cloud = transport;
    phone = await device("phone");
    await saveBlockProgress("m01-1", "forms", { done: true }, phone.db);
    during = true;
    const status = await phone.sync.exchange();
    expect(status.phase).toBe("error");
    // Первая версия опубликована без изменения, сделанного во время её выгрузки, а отметка не снята.
    expect(await readMeta(phone.db, META.dirty)).toBeTruthy();
    const desktop = await device("desktop");
    await desktop.sync.exchange();
    expect((await blockProgressOf("m01-1", desktop.db)).has("cafe-q")).toBe(false);
    expect((await phone.sync.exchange()).phase).toBe("synced");
    expect(await readMeta(phone.db, META.dirty)).toBeNull();
    await desktop.sync.exchange();
    expect((await blockProgressOf("m01-1", desktop.db)).get("cafe-q")?.done).toBe(true);
  });

  it("смена аккаунта при ожидающей отправке: данные A не уходят в облако B и ждут A", async () => {
    const cloudA = memoryTransport({
      intercept: (op) => {
        if (op === "setItem" && offline) throw new Error("нет сети");
      },
    });
    let offline = true;
    const cloudB = memoryTransport();
    const scheduled: { run: () => void; cancelled: boolean }[] = [];
    const accountA = await device("account-a", { transport: cloudA, scheduled });
    await finishLesson(accountA);
    expect((await accountA.sync.exchange()).phase).toBe("error");
    expect(await readMeta(accountA.db, META.dirty)).toBeTruthy();
    // Приложение открыто под B: координатор A остановлен, у B — своя база.
    accountA.sync.stop();
    expect(scheduled.every((entry) => entry.cancelled)).toBe(true);
    const accountB = await device("account-b", { transport: cloudB });
    await saveSettings({ ...defaultSettings, sessionSize: 4 }, accountB.db);
    expect((await accountB.sync.exchange()).phase).toBe("synced");
    const published = [...cloudB.store.entries()];
    expect(pointers(cloudB.store)).toHaveLength(1);
    const deviceA = await readMeta(accountA.db, META.device);
    expect(published.some(([key]) => key.includes(deviceA!))).toBe(false);
    expect(await accountB.db.blockProgress.count()).toBe(0);
    const inB = await accountB.db.transaction("r", accountB.db.tables, () => buildSnapshot(accountB.db, now()));
    expect(inB.blocks).toEqual([]);
    expect(inB.lessons.find((lesson) => lesson.id === "m01-1")?.status).toBe("upcoming");
    expect(cloudA.store.size).toBe(0);
    offline = false;
    expect((await accountA.sync.exchange()).phase).toBe("synced");
    expect(pointers(cloudA.store)).toHaveLength(1);
    expect(pointers(cloudB.store)).toHaveLength(1);
  });
});

/** `drop` — ответ на вызов теряется, хотя запись выполнена. */
function fakeCloudStorage(
  memory: MemoryTransport,
  drop: (op: string, key: string) => boolean = () => false,
): TelegramCloudStorage {
  const call = <T>(op: string, key: string, task: Promise<T>, done?: (error: string | null, value?: T) => void) => {
    task.then(
      (value) => {
        if (!drop(op, key)) done?.(null, value);
      },
      (error) => done?.(String(error.message)),
    );
  };
  return {
    setItem: (key, value, done) =>
      call(
        "setItem",
        key,
        memory.setItem(key, value).then(() => true),
        done,
      ),
    getItem: (key, done) =>
      call(
        "getItem",
        key,
        memory.getItems([key]).then((items) => items[key]),
        done,
      ),
    getItems: (keys, done) => call("getItems", "", memory.getItems(keys), done),
    removeItem: (key, done) =>
      call(
        "removeItem",
        key,
        memory.removeItems([key]).then(() => true),
        done,
      ),
    removeItems: (keys, done) =>
      call(
        "removeItems",
        "",
        memory.removeItems(keys).then(() => true),
        done,
      ),
    getKeys: (done) => call("getKeys", "", memory.getKeys(), done),
  };
}
