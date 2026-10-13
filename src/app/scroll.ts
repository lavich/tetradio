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

/** Позиция «Назад» возвращается, когда экран дорос до неё: данные приходят live-запросами после первого кадра. */
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
    const app = root.current;
    let observer: ResizeObserver | undefined;
    let timer = 0;
    let frame = 0;
    const listen = (on: boolean) => {
      for (const type of USER_INPUT)
        if (on) window.addEventListener(type, stop, { passive: true });
        else window.removeEventListener(type, stop);
    };
    function stop() {
      observer?.disconnect();
      clearTimeout(timer);
      listen(false);
      // Снимается через кадр: размеры частей должны успеть запомниться (contain-intrinsic-size: auto).
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => app?.removeAttribute("data-restoring"));
      });
    }
    const attempt = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) < 1) stop();
    };
    const cleanup = () => {
      stop();
      cancelAnimationFrame(frame);
      app?.removeAttribute("data-restoring");
    };
    if (!target || !app || typeof ResizeObserver !== "function") {
      window.scrollTo(0, target);
      return;
    }
    // Без content-visibility на время возврата: оценка высоты непоказанных частей сдвинула бы позицию.
    app.setAttribute("data-restoring", "");
    attempt();
    if (Math.abs(window.scrollY - target) >= 1) {
      observer = new ResizeObserver(attempt);
      observer.observe(app);
      timer = window.setTimeout(stop, RESTORE_TIMEOUT);
      listen(true);
    }
    return cleanup;
  }, [location.key, location.pathname, location.state, action, root]);
}
