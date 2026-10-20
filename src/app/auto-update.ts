import { useSyncExternalStore } from "react";
import { skipStartRouteOnReload } from "../platform/launch";

/** Новая сборка ждёт (`onNeedRefresh`): уведомление «Обновить» и его действие. */
export const updateReady = { value: false, apply: () => {} };
export const UPDATE_TOAST = "app-update";

type Installing = Pick<EventTarget, "addEventListener"> & { state: string };
type Registration = {
  waiting: { postMessage(message: unknown): void } | null;
  installing: Installing | null;
  update(): Promise<unknown>;
};
export interface AutoUpdatePorts {
  /** `navigator.serviceWorker`; `null` — клиент без service worker. */
  container: Pick<EventTarget, "addEventListener"> | null;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  build: string;
  reload: () => void;
  /** Перезагрузка — тот же запуск: путь из ссылки уже открывали. Плагин PWA тоже может перезагрузить страницу. */
  markReload: () => void;
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
 * Обработчик `controlling` плагина PWA ставится только после его `onNeedRefresh` и перезагружает лишь при
 * `isUpdate`, а ожидающую сборку мы могли застать и без него: поэтому своя перезагрузка по `controllerchange`.
 */
export function createAutoUpdater(ports: AutoUpdatePorts) {
  let wanted = false;
  let ready = false;
  let applied = false;
  let reloaded = false;
  let waitingSeen = false;
  let registration: Registration | null = null;
  let withoutWorker = ports.container === null;
  let unsupported = false;
  let route = "";
  let lastInteraction = ports.now();
  let state: AutoUpdateState = "idle";
  let cancelCheck: (() => void) | null = null;
  let holds = 0;
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
  const safe = () => route === SAFE_ROUTE && holds === 0 && !ports.busy() && ports.now() - lastInteraction >= IDLE_MS;
  const apply = () => {
    applied = true;
    cancelCheck?.();
    ports.markReload();
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
        const installing = current.installing;
        if (current.waiting) becomeReady();
        else if (!installing) {
          if (!ready) setState("none");
        } else
          // Сорвавшаяся установка не даёт `onNeedRefresh`: без этого статус навсегда остался бы «Обновляем…».
          installing.addEventListener("statechange", () => {
            if (installing.state === "redundant" && !ready) setState("none");
            else if (current.waiting) becomeReady();
          });
      },
      () => setState("none"),
    );
  };

  return {
    request() {
      if (wanted) return;
      wanted = true;
      if (unsupported || (withoutWorker && reloadedOnThisBuild())) return setState("none");
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
    /** Сборка без регистрации service worker (разработка без `devOptions`): обновиться само нечем. */
    unsupported() {
      unsupported = true;
      if (wanted && !ready) setState("none");
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
    /**
     * Незаконченная работа, которую не видно по экрану: загрузка курса, восстановление копии, нативное окно
     * передачи файла. Она могла начаться на другом экране и продолжаться на «Сегодня».
     */
    hold<T>(work: Promise<T>): Promise<T> {
      holds++;
      return work.finally(() => {
        holds--;
        lastInteraction = ports.now();
      });
    },
    held: () => holds > 0,
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
  markReload: skipStartRouteOnReload,
  dismissNotice: () => void import("sonner").then(({ toast }) => toast.dismiss(UPDATE_TOAST)).catch(() => undefined),
  busy: () => !!document.querySelector('[role="dialog"], [role="alertdialog"]') || editable(document.activeElement),
  now: () => Date.now(),
  schedule: (run, ms) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
});
const INTERACTIONS = ["pointerdown", "keydown", "wheel", "touchmove", "scroll"];
export function bindInteractions(
  target: Pick<EventTarget, "addEventListener">,
  updater: Pick<AutoUpdater, "interacted">,
) {
  const interacted = () => updater.interacted();
  for (const type of INTERACTIONS) target.addEventListener(type, interacted, { capture: true, passive: true });
}
if (typeof window !== "undefined") {
  bindInteractions(window, autoUpdate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") autoUpdate.visible();
  });
  window.addEventListener("tetradio:newer-format", () => autoUpdate.request());
}
export const holdUpdate = <T>(work: Promise<T>) => autoUpdate.hold(work);
export const useAutoUpdateState = () => useSyncExternalStore(autoUpdate.subscribe, autoUpdate.state, autoUpdate.state);
