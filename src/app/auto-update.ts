import { useSyncExternalStore } from "react";

/** Новая сборка ждёт (`onNeedRefresh`): уведомление «Обновить» и его действие. */
export const updateReady = { value: false, apply: () => {} };
export const UPDATE_TOAST = "app-update";

type Registration = {
  waiting: { postMessage(message: unknown): void } | null;
  installing: unknown;
  update(): Promise<unknown>;
};
export interface AutoUpdatePorts {
  /** `navigator.serviceWorker`; `null` — клиент без service worker. */
  container: Pick<EventTarget, "addEventListener"> | null;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  build: string;
  reload: () => void;
  dismissNotice: () => void;
  busy: () => boolean;
  now: () => number;
  schedule: (run: () => void, ms: number) => () => void;
}
/** `updating` — новая сборка ищется или ждёт безопасного момента; `none` — обновиться само не может. */
export type AutoUpdateState = "idle" | "updating" | "none";

const IDLE_MS = 3000;
const CHECK_MS = 1000;
const RELOADED_KEY = "tetradio:auto-update-build";
const SAFE_ROUTE = "/";

/**
 * Тихое обновление, когда в облаке версия формата новее приложения: новая сборка применяется сама в безопасный
 * момент — на «Сегодня», без диалога и ввода, после паузы без касаний. Остальные обновления — через уведомление.
 * `updateSW` из `vite-plugin-pwa` только посылает `SKIP_WAITING`, а перезагружает лишь при `isUpdate` своего
 * обработчика `controlling`, поэтому перезагрузка по `controllerchange` — здесь.
 */
export function createAutoUpdater(ports: AutoUpdatePorts) {
  let wanted = false;
  let ready = false;
  let applied = false;
  let reloaded = false;
  let waitingSeen = false;
  let registration: Registration | null = null;
  let withoutWorker = ports.container === null;
  let route = "";
  let lastInteraction = ports.now();
  let state: AutoUpdateState = "idle";
  let cancelCheck: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const setState = (next: AutoUpdateState) => {
    if (state === next) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    ports.reload();
  };
  const safe = () => route === SAFE_ROUTE && !ports.busy() && ports.now() - lastInteraction >= IDLE_MS;
  const apply = () => {
    applied = true;
    cancelCheck?.();
    if (withoutWorker) {
      try {
        ports.storage?.setItem(RELOADED_KEY, ports.build);
      } catch {
        /* без записи отметки повтор всё равно ограничен: перезагрузка — одна на жизнь страницы */
      }
      reloadOnce();
      return;
    }
    ports.container!.addEventListener("controllerchange", reloadOnce);
    const waiting = registration?.waiting;
    if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
    else reloadOnce();
  };
  const check = () => {
    cancelCheck = null;
    if (!wanted || !ready || applied) return;
    if (safe()) apply();
    else cancelCheck = ports.schedule(check, CHECK_MS);
  };
  const becomeReady = () => {
    if (ready) return;
    ready = true;
    setState("updating");
    check();
  };
  const reloadedOnThisBuild = () => {
    try {
      return ports.storage?.getItem(RELOADED_KEY) === ports.build;
    } catch {
      return true;
    }
  };
  const startWithoutWorker = () => {
    withoutWorker = true;
    if (reloadedOnThisBuild()) setState("none");
    else becomeReady();
  };
  const search = () => {
    if (!registration || ready) return;
    if (waitingSeen || registration.waiting) return becomeReady();
    const current = registration;
    current.update().then(
      () => {
        if (current.waiting) becomeReady();
        else if (!current.installing && !ready) setState("none");
      },
      () => setState("none"),
    );
  };

  return {
    request() {
      if (wanted) return;
      wanted = true;
      setState("updating");
      if (waitingSeen || updateReady.value) {
        updateReady.value = false;
        ports.dismissNotice();
      }
      if (withoutWorker) startWithoutWorker();
      else search();
    },
    registered(next: Registration) {
      registration = next;
      if (wanted) search();
    },
    registerFailed() {
      if (wanted && !ready) startWithoutWorker();
      else withoutWorker = true;
    },
    /** `true` — обновление применится само, уведомление не нужно. */
    needRefresh() {
      waitingSeen = true;
      if (!wanted) return false;
      becomeReady();
      return true;
    },
    route(path: string) {
      route = path;
      lastInteraction = ports.now();
      if (ready && !applied && !cancelCheck) check();
    },
    interacted() {
      lastInteraction = ports.now();
    },
    visible() {
      lastInteraction = ports.now();
      if (ready && !applied && !cancelCheck) check();
    },
    state: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type AutoUpdater = ReturnType<typeof createAutoUpdater>;

const editable = (element: Element | null) =>
  !!element &&
  (element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element as HTMLElement).isContentEditable);

export const autoUpdate = createAutoUpdater({
  container: typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null,
  storage: (() => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  })(),
  build: typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "dev",
  reload: () => window.location.reload(),
  dismissNotice: () => void import("sonner").then(({ toast }) => toast.dismiss(UPDATE_TOAST)).catch(() => undefined),
  busy: () => !!document.querySelector('[role="dialog"], [role="alertdialog"]') || editable(document.activeElement),
  now: () => Date.now(),
  schedule: (run, ms) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
});
if (typeof window !== "undefined") {
  const interacted = () => autoUpdate.interacted();
  window.addEventListener("pointerdown", interacted, { capture: true, passive: true });
  window.addEventListener("keydown", interacted, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") autoUpdate.visible();
  });
  window.addEventListener("tetradio:newer-format", () => autoUpdate.request());
}
export const useAutoUpdateState = () => useSyncExternalStore(autoUpdate.subscribe, autoUpdate.state, autoUpdate.state);
