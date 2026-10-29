import { useEffect, useState } from "react";

let conflictDialog: Promise<typeof import("./TelegramNotices")> | undefined;
/** Чанк диалога берётся заранее, пока сборка на сервере та же: после деплоя у спящего WebView старого чанка уже нет. */
export function loadConflictDialog() {
  conflictDialog ??= import("./TelegramNotices").catch((error: unknown) => {
    conflictDialog = undefined;
    throw error;
  });
  return conflictDialog;
}

let syncChunk: Promise<typeof import("../sync")> | undefined;
/** Один запрос чанка синхронизации на подключение облака и на слежение за конфликтом. */
export function loadSync() {
  syncChunk ??= import("../sync").catch((error: unknown) => {
    syncChunk = undefined;
    throw error;
  });
  return syncChunk;
}

/** После загрузки страницы и паузы: запросы не делят канал с первым экраном (каталог, шрифты). */
export function afterStartup(run: () => void, delayMs = 2000): () => void {
  let cancel = () => {};
  const wait = () => {
    const timer = setTimeout(() => {
      if (typeof requestIdleCallback === "function") {
        const id = requestIdleCallback(run, { timeout: 5000 });
        cancel = () => cancelIdleCallback(id);
      } else run();
    }, delayMs);
    cancel = () => clearTimeout(timer);
  };
  if (document.readyState === "complete") wait();
  else window.addEventListener("load", wait, { once: true });
  return () => {
    window.removeEventListener("load", wait);
    cancel();
  };
}

const early = new Set<() => void>();
/** Экрану, которому нужно облако (копия, статус синхронизации), пауза после запуска не нужна. */
export function syncNeededNow() {
  for (const run of early) run();
}

/** Как `afterStartup`, но `syncNeededNow` запускает раньше срока; запуск ровно один раз. */
export function afterStartupOrNeeded(run: () => void, delayMs?: number): () => void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    early.delete(once);
    cancel();
    run();
  };
  const cancel = afterStartup(once, delayMs);
  early.add(once);
  return () => {
    done = true;
    early.delete(once);
    cancel();
  };
}

const INTERACTIONS = ["pointerdown", "keydown"] as const;

/** Первое касание или клавиша: всплывающие сообщения появляются только в ответ на действия, их чанк ждёт до них. */
export function useFirstInteraction(): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return;
    const mark = () => setDone(true);
    for (const type of INTERACTIONS) window.addEventListener(type, mark, { capture: true, once: true });
    return () => {
      for (const type of INTERACTIONS) window.removeEventListener(type, mark, { capture: true });
    };
  }, [done]);
  return done;
}

let conflictOnce = false;
/** Диалог конфликта монтируется с первого конфликта и остаётся: чанк не грузится заново при каждом конфликте. */
export function useSyncConflictSeen(): boolean {
  const [seen, setSeen] = useState(conflictOnce);
  useEffect(() => {
    if (seen) return;
    let live = true;
    let unsubscribe: (() => void) | undefined;
    const cancel = afterStartupOrNeeded(() => {
      loadSync()
        .then(({ sync }) => {
          if (!live) return;
          const check = () => {
            if (sync.getStatus().phase !== "conflict") return;
            conflictOnce = true;
            setSeen(true);
          };
          unsubscribe = sync.subscribe(check);
          check();
        })
        .catch(() => undefined);
    });
    return () => {
      live = false;
      cancel();
      unsubscribe?.();
    };
  }, [seen]);
  return seen;
}
