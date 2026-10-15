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

/** Диалог конфликта монтируется с первого конфликта и остаётся: его «Решить позже» живёт в состоянии диалога. */
export function useSyncConflictSeen(): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    let live = true;
    let unsubscribe: (() => void) | undefined;
    import("../sync")
      .then(({ sync }) => {
        if (!live) return;
        const check = () => {
          if (sync.getStatus().phase === "conflict") setSeen(true);
        };
        unsubscribe = sync.subscribe(check);
        check();
      })
      .catch(() => undefined);
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [seen]);
  return seen;
}
