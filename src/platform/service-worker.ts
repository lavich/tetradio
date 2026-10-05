import type { Blocked, Profile } from "../storage/profile";

/** Кэш кода нужен Mini App, чтобы занятие не обрывалось без сети; вне Telegram приложение уходит на лендинг. */
export const wantsServiceWorker = (launch: Profile | Blocked) =>
  !(launch.kind === "blocked" && launch.reason === "outside-telegram");

const RELOADED_KEY = "tetradio:sw-dropped";

interface DropPorts {
  /** Область снимаемой регистрации: прежние версии ставили service worker на весь сайт, теперь он только в `app/`. */
  scope: string;
  container: Pick<ServiceWorkerContainer, "getRegistrations" | "controller">;
  caches?: Pick<CacheStorage, "keys" | "delete">;
  session?: Pick<Storage, "getItem" | "setItem">;
  /** Страницу, отданную из кэша снятого service worker, перезагрузить один раз; без этого — не перезагружать. */
  reload?: () => void;
}

export async function dropServiceWorker({ scope, container, caches, session, reload }: DropPorts): Promise<boolean> {
  const registrations = (await container.getRegistrations()).filter((registration) => registration.scope === scope);
  if (!registrations.length) return false;
  const controlled = !!container.controller;
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (caches) {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("workbox-") && key.endsWith(`-${scope}`)).map((key) => caches.delete(key)),
    );
  }
  if (reload && controlled && session?.getItem(RELOADED_KEY) !== "1") {
    session?.setItem(RELOADED_KEY, "1");
    reload();
  }
  return true;
}
