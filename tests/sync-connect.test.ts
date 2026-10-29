// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { TelegramWebApp } from "../src/platform/telegram-types";

vi.mock("../src/storage/profile", async (original) => ({
  ...(await original<typeof import("../src/storage/profile")>()),
  currentProfile: () => ({ kind: "telegram", userId: 7, bot: "TetradioBot", syncable: true }),
}));

function bridge(version = "8.0") {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  type Done<T> = (error: string | null, value?: T) => void;
  const app = {
    CloudStorage: {
      setItem: (key: string, value: string, done: Done<boolean>) => (store.set(key, value), done(null, true)),
      getItem: (key: string, done: Done<string>) => done(null, store.get(key) ?? ""),
      getItems: (keys: string[], done: Done<Record<string, string>>) =>
        done(null, Object.fromEntries(keys.map((key) => [key, store.get(key) ?? ""]))),
      removeItem: (key: string, done: Done<boolean>) => (store.delete(key), done(null, true)),
      removeItems: (keys: string[], done: Done<boolean>) => (
        keys.forEach((key) => store.delete(key)),
        done(null, true)
      ),
      getKeys: (done: Done<string[]>) => done(null, [...store.keys()]),
    },
    isVersionAtLeast: (wanted: string) => Number(version) >= Number(wanted),
    onEvent: (name: string, listener: () => void) =>
      listeners.set(name, (listeners.get(name) ?? new Set()).add(listener)),
    offEvent: (name: string, listener: () => void) => listeners.get(name)?.delete(listener),
  } as unknown as TelegramWebApp;
  return { app, store, emit: (name: string) => listeners.get(name)?.forEach((listener) => listener()) };
}

describe("подключение облака", () => {
  it("сигнал Telegram «ушло в фон» отправляет неопубликованное в облако", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: async (_name: string, _options: unknown, run: (lock: object) => Promise<void>) => run({}) },
    });
    const { connectSync, sync } = await import("../src/sync");
    const { db } = await import("../src/storage/db");
    const { markChanged } = await import("../src/storage/ops");
    const { app, store, emit } = bridge();
    await db.open();
    connectSync(app);
    await vi.waitFor(() => expect(sync.getStatus().phase).toBe("synced"));
    expect([...store.keys()].some((key) => key.startsWith("p_"))).toBe(false);
    await db.transaction("rw", db.meta, () => markChanged(db));
    emit("deactivated");
    await vi.waitFor(() => expect([...store.keys()].some((key) => key.startsWith("p_"))).toBe(true));
    sync.stop();
  });

  it("Telegram ниже 6.9 — клиент без облака: хранилище не вызывается", async () => {
    const { connectSync, sync } = await import("../src/sync");
    const { app } = bridge("6.0");
    const getItems = vi.fn();
    (app.CloudStorage as unknown as { getItems: unknown }).getItems = getItems;
    connectSync(app);
    await sync.exchange().catch(() => undefined);
    expect(getItems).not.toHaveBeenCalled();
    expect(sync.getStatus().error?.kind).not.toBe("bridge");
    sync.stop();
  });
});
