// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession } from "../src/domain/learning";
import { defaultSettings, type Session } from "../src/domain/types";
import { AppDatabase } from "../src/storage/db";
import { endSession, saveSettings, skipItem, submitAnswer } from "../src/storage/ops";
import { dexieSource } from "../src/storage/queries";
import { kvAdapter } from "../src/sync/adapter";
import { EXCHANGE_INTERVAL_MS, SyncCoordinator } from "../src/sync/coordinator";
import { META, readMeta } from "../src/sync/snapshot";
import { memoryTransport } from "../src/sync/transport";
import { installCompleted } from "./helpers/content";

let clockMs = Date.parse("2026-09-16T08:00:00Z");
const now = () => new Date(clockMs);
let counter = 0;
interface Timer {
  run: () => void;
  delay: number;
  cancelled: boolean;
}
let timers: Timer[];
const live = () => timers.filter((timer) => !timer.cancelled);

async function setup() {
  const db = new AppDatabase(`tetradio-sync-cadence-${++counter}`);
  await db.delete();
  await db.open();
  await installCompleted(db, ["mech-1"]);
  const sync = new SyncCoordinator({
    database: db,
    adapter: kvAdapter(memoryTransport()),
    now,
    schedule: (run, delay) => {
      const timer = { run, delay, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    retryBaseMs: 1,
  });
  const exchange = vi.spyOn(sync, "exchange");
  sync.start();
  await vi.waitFor(() => expect(sync.getStatus().phase).toBe("synced"));
  exchange.mockClear();
  return { db, sync, exchange };
}
async function session(db: AppDatabase): Promise<Session> {
  clockMs += 60_000;
  const made = await makeSession({ source: dexieSource(db), now: now(), random: Math.random });
  await db.sessions.add(made);
  return made;
}
const answer = (db: AppDatabase, made: Session, index: number) =>
  submitAnswer({
    session: made,
    item: made.items[index],
    correct: true,
    answer: "",
    responseTimeMs: 900,
    activeTimeMs: 900,
    timezone: "Asia/Nicosia",
    now: now(),
    database: db,
  });
const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

let stop: (() => void) | null = null;
beforeEach(() => {
  timers = [];
  clockMs = Date.parse("2026-09-16T08:00:00Z");
});
afterEach(() => {
  stop?.();
  stop = null;
  setVisibility("visible");
});

describe("частота публикации", () => {
  it("ответы занятия копятся на устройстве, выход из занятия публикует их", async () => {
    const { db, sync, exchange } = await setup();
    stop = () => sync.stop();
    const made = await session(db);
    expect(made.items.length).toBeGreaterThan(3);
    for (const index of [0, 1, 2]) await answer(db, made, index);
    expect(exchange).not.toHaveBeenCalled();
    expect(live()).toHaveLength(0);
    expect(await readMeta(db, META.dirty)).toBeTruthy(); // отметка в базе переживёт закрытие приложения
    await endSession((await db.sessions.get(made.id))!, db);
    expect(exchange).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect(await readMeta(db, META.dirty)).toBeNull());
  });
  it("последнее задание завершает занятие — ответом или пропуском — и публикует сразу", async () => {
    for (const last of ["answer", "skip"] as const) {
      const { db, sync, exchange } = await setup();
      stop = () => sync.stop();
      const made = await session(db);
      const final = made.items.length - 1;
      for (let index = 0; index < final; index++) await answer(db, made, index);
      expect(exchange).not.toHaveBeenCalled();
      if (last === "answer") await answer(db, made, final);
      else await skipItem(made.id, made.items[final].id, 900, db);
      expect(exchange, last).toHaveBeenCalledTimes(1);
      sync.stop();
    }
  });
  it("сворачивание публикует накопленное, а без изменений облако не трогает", async () => {
    const { db, sync, exchange } = await setup();
    stop = () => sync.stop();
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(exchange).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(exchange).toHaveBeenCalledTimes(1); // возврат — как раньше, обмен сразу
    await vi.waitFor(() => expect(sync.getStatus().phase).toBe("synced"));
    exchange.mockClear();
    const made = await session(db);
    await answer(db, made, 0);
    setVisibility("hidden");
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await readMeta(db, META.dirty)).toBeNull());
  });
  it("прочие изменения — не чаще раза в две минуты, ручной повтор — сразу", async () => {
    const { db, sync, exchange } = await setup();
    stop = () => sync.stop();
    clockMs += 30_000;
    await saveSettings({ ...defaultSettings, sessionSize: 7 }, db);
    await saveSettings({ ...defaultSettings, sessionSize: 8 }, db);
    expect(exchange).not.toHaveBeenCalled();
    expect(live()).toHaveLength(1);
    expect(live()[0].delay).toBe(EXCHANGE_INTERVAL_MS - 30_000);
    await sync.exchange();
    expect(exchange).toHaveBeenCalledTimes(1);
    live()[0].run();
    expect(exchange).toHaveBeenCalledTimes(2);
    // После долгого затишья изменение уходит почти сразу.
    clockMs += 10 * 60_000;
    await vi.waitFor(() => expect(sync.getStatus().phase).toBe("synced"));
    await saveSettings({ ...defaultSettings, sessionSize: 9 }, db);
    expect(live().at(-1)!.delay).toBeLessThan(5000);
  });
});
