import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const PREFIX = "scroll:";
const RESTORE_TIMEOUT = 3000;
const USER_INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** Переход по ссылке с таким состоянием оставляет прокрутку: на развороте словаря лист слова липнет к верху сам. */
export const KEEP_SCROLL = { keepScroll: true };

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

/**
 * Прокрутка окна между экранами: переход вперёд открывает экран сверху, «Назад» возвращает прежнюю позицию.
 * Замена адреса на том же экране (поиск словаря, страница урока) прокрутку не трогает. Позиция возвращается, когда
 * экран дорос до неё: данные экранов приходят live-запросами уже после первого кадра.
 */
export function useScrollMemory(root: RefObject<HTMLElement | null>) {
  const location = useLocation();
  const action = useNavigationType();
  const current = useRef(location.key);
  const path = useRef(location.pathname);

  useEffect(() => {
    history.scrollRestoration = "manual";
    const save = () => savePosition(current.current, Math.round(window.scrollY));
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);

  useLayoutEffect(() => {
    current.current = location.key;
    const moved = path.current !== location.pathname;
    path.current = location.pathname;
    if (action !== "POP") {
      const keep = (location.state as { keepScroll?: boolean } | null)?.keepScroll;
      if (!keep && (action === "PUSH" || moved)) window.scrollTo(0, 0);
      return;
    }
    const target = readPosition(location.key);
    let observer: ResizeObserver | undefined;
    let timer = 0;
    const stop = () => {
      observer?.disconnect();
      clearTimeout(timer);
      for (const type of USER_INPUT) window.removeEventListener(type, stop);
    };
    const attempt = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) < 1) stop();
    };
    attempt();
    if (Math.abs(window.scrollY - target) < 1 || !root.current || typeof ResizeObserver !== "function") return stop;
    observer = new ResizeObserver(attempt);
    observer.observe(root.current);
    timer = window.setTimeout(stop, RESTORE_TIMEOUT);
    for (const type of USER_INPUT) window.addEventListener(type, stop, { passive: true });
    return stop;
  }, [location.key, location.pathname, location.state, action, root]);
}
