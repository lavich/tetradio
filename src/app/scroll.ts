import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const PREFIX = "scroll:";
const RESTORE_TIMEOUT = 3000;
const USER_INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** Переход по ссылке с таким состоянием оставляет прокрутку: на развороте словаря лист слова липнет к верху сам. */
export const KEEP_SCROLL = { keepScroll: true };

const loadType = () =>
  (performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? "navigate";

function readPosition(key: string) {
  try {
    return Number(sessionStorage.getItem(PREFIX + key)) || 0;
  } catch {
    return 0;
  }
}
function savePosition(key: string, top: number) {
  try {
    sessionStorage.setItem(PREFIX + key, String(top));
  } catch {
    // Без sessionStorage «Назад» просто откроет экран сверху.
  }
}

const UNKEYED = "default";
const RESTORING = "data-restoring";
const SETTLED_FRAMES = 10;
const IDLE_FRAMES = 60;

/** Для replace перед PUSH: маршрутизатор сливает их в один переход, и хук замены не увидит. */
export function rememberScroll() {
  const key = (window.history.state as { key?: string } | null)?.key ?? UNKEYED;
  savePosition(key, Math.round(window.scrollY));
}

/** Позиция «Назад» возвращается, когда экран дорос до неё: данные приходят live-запросами после первого кадра. */
export function useScrollMemory(root: RefObject<HTMLElement | null>) {
  const location = useLocation();
  const action = useNavigationType();
  const current = useRef(location.key);
  const path = useRef(location.pathname);

  useEffect(() => {
    history.scrollRestoration = "manual";
    const save = () => {
      if (root.current?.hasAttribute(RESTORING)) return;
      savePosition(current.current, Math.round(window.scrollY));
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [root]);

  useLayoutEffect(() => {
    const previous = current.current;
    const mounted = previous === location.key;
    current.current = location.key;
    const moved = path.current !== location.pathname;
    path.current = location.pathname;
    if (action === "POP") {
      // Первая запись вкладки всегда "default": новая загрузка взяла бы позицию прошлой.
      if (mounted && location.key === UNKEYED && loadType() === "navigate") return savePosition(UNKEYED, 0);
      return restore(root.current, location.key, readPosition(location.key));
    }
    if (action === "REPLACE" && !moved) return savePosition(location.key, readPosition(previous));
    if ((location.state as { keepScroll?: boolean } | null)?.keepScroll)
      return restore(root.current, location.key, readPosition(previous));
    window.scrollTo(0, 0);
  }, [location.key, location.pathname, location.state, action, root]);
}

function restore(app: HTMLElement | null, key: string, target: number) {
  savePosition(key, target);
  window.scrollTo(0, target);
  if (!app || Math.abs(window.scrollY - target) < 1) return;
  let timer = 0;
  let frame = 0;
  let height = -1;
  let grown = false;
  let still = 0;
  const listen = (on: boolean) => {
    for (const type of USER_INPUT)
      if (on) window.addEventListener(type, stop, { passive: true });
      else window.removeEventListener(type, stop);
  };
  function stop() {
    clearTimeout(timer);
    listen(false);
    // Через два кадра: contain-intrinsic-size: auto должен успеть запомнить настоящие высоты.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => app?.removeAttribute(RESTORING));
    });
  }
  const tick = () => {
    const now = document.documentElement.scrollHeight;
    if (now !== height) {
      grown ||= height >= 0;
      height = now;
      still = 0;
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) < 1) return stop();
    } else if (++still >= (grown ? SETTLED_FRAMES : IDLE_FRAMES)) return stop();
    frame = requestAnimationFrame(tick);
  };
  app.setAttribute(RESTORING, "");
  timer = window.setTimeout(stop, RESTORE_TIMEOUT);
  listen(true);
  tick();
  return () => {
    stop();
    cancelAnimationFrame(frame);
    app.removeAttribute(RESTORING);
  };
}
