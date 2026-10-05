import { describe, expect, it, vi } from "vitest";
import { dropServiceWorker, wantsServiceWorker } from "../src/platform/service-worker";

const unregister = vi.fn(async () => true);
const registration = () => ({ unregister }) as unknown as ServiceWorkerRegistration;
const memorySession = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

describe("service worker только в Telegram", () => {
  it("вне Telegram не нужен; в Telegram, в моке и при ошибке запуска внутри Telegram — нужен", () => {
    expect(wantsServiceWorker({ kind: "blocked", reason: "outside-telegram", bot: "b" })).toBe(false);
    expect(wantsServiceWorker({ kind: "blocked", reason: "no-user", bot: "b" })).toBe(true);
    expect(
      wantsServiceWorker({
        kind: "telegram",
        bot: "b",
        userId: 1,
        databaseName: "x",
        syncable: true,
        label: "",
      }),
    ).toBe(true);
  });

  it("снимает прежний service worker и его кэш, страницу из кэша перезагружает один раз", async () => {
    const regs = [registration()];
    const deleted: string[] = [];
    const reload = vi.fn();
    const session = memorySession();
    const ports = {
      container: { getRegistrations: async () => regs, controller: {} as ServiceWorker },
      caches: {
        keys: async () => ["workbox-precache-v2-https://tetradio.app/", "other"],
        delete: async (key: string) => (deleted.push(key), true),
      },
      session,
      reload,
    };
    expect(await dropServiceWorker(ports)).toBe(true);
    expect(unregister).toHaveBeenCalled();
    expect(deleted).toEqual(["workbox-precache-v2-https://tetradio.app/"]);
    expect(reload).toHaveBeenCalledTimes(1);
    await dropServiceWorker(ports);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("без установленного service worker ничего не делает", async () => {
    const reload = vi.fn();
    expect(await dropServiceWorker({ container: { getRegistrations: async () => [], controller: null }, reload })).toBe(
      false,
    );
    expect(reload).not.toHaveBeenCalled();
  });
});
