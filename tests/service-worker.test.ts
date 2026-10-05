import { describe, expect, it, vi } from "vitest";
import { dropServiceWorker, wantsServiceWorker } from "../src/platform/service-worker";

const ROOT = "https://tetradio.app/";
const APP = "https://tetradio.app/app/";
const registration = (scope: string) => {
  const unregister = vi.fn(async () => true);
  return { registration: { scope, unregister } as unknown as ServiceWorkerRegistration, unregister };
};
const memorySession = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

describe("service worker только у Mini App", () => {
  it("вне Telegram не нужен; в Telegram, в моке и при ошибке запуска внутри Telegram — нужен", () => {
    expect(wantsServiceWorker({ kind: "blocked", reason: "outside-telegram", bot: "b" })).toBe(false);
    expect(wantsServiceWorker({ kind: "blocked", reason: "no-user", bot: "b" })).toBe(true);
    expect(
      wantsServiceWorker({ kind: "telegram", bot: "b", userId: 1, databaseName: "x", syncable: true, label: "" }),
    ).toBe(true);
  });

  it("снимает только прежнюю регистрацию на весь сайт и её кэш; кэш приложения остаётся", async () => {
    const root = registration(ROOT);
    const app = registration(APP);
    const deleted: string[] = [];
    const reload = vi.fn();
    const ports = {
      scope: ROOT,
      container: {
        getRegistrations: async () => [root.registration, app.registration],
        controller: {} as ServiceWorker,
      },
      caches: {
        keys: async () => [`workbox-precache-v2-${ROOT}`, `workbox-precache-v2-${APP}`, "other"],
        delete: async (key: string) => (deleted.push(key), true),
      },
      session: memorySession(),
      reload,
    };
    expect(await dropServiceWorker(ports)).toBe(true);
    expect(root.unregister).toHaveBeenCalled();
    expect(app.unregister).not.toHaveBeenCalled();
    expect(deleted).toEqual([`workbox-precache-v2-${ROOT}`]);
    expect(reload).toHaveBeenCalledTimes(1);
    await dropServiceWorker(ports);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("без прежней регистрации ничего не делает; без reload страницу не перезагружает", async () => {
    const app = registration(APP);
    expect(
      await dropServiceWorker({
        scope: ROOT,
        container: { getRegistrations: async () => [app.registration], controller: null },
      }),
    ).toBe(false);
    expect(app.unregister).not.toHaveBeenCalled();
  });
});
