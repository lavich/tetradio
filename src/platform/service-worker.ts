import type { Blocked, Profile } from "../storage/profile";

/** Кэш кода нужен Mini App, чтобы занятие не обрывалось без сети; лендинг вне Telegram должен всегда быть свежим. */
export const wantsServiceWorker = (launch: Profile | Blocked) =>
  !(launch.kind === "blocked" && launch.reason === "outside-telegram");

const RELOADED_KEY = "tetradio:sw-dropped";

interface DropPorts {
  container: Pick<ServiceWorkerContainer, "getRegistrations" | "controller">;
  caches?: Pick<CacheStorage, "keys" | "delete">;
  session?: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
}

/** Снимает service worker, поставленный прежней версией. Страницу, отданную из его кэша, один раз перезагружает. */
export async function dropServiceWorker({ container, caches, session, reload }: DropPorts): Promise<boolean> {
  const registrations = await container.getRegistrations();
  if (!registrations.length) return false;
  const controlled = !!container.controller;
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (caches) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("workbox-")).map((key) => caches.delete(key)));
  }
  if (controlled && session?.getItem(RELOADED_KEY) !== "1") {
    session?.setItem(RELOADED_KEY, "1");
    reload();
  }
  return true;
}
