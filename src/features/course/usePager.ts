import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { scrollsSideways } from "./paginate";

/**
 * Листание урока: номер страницы в адресе (`p`), стрелки клавиатуры и свайп. На развороте шаг — две страницы.
 * `opening` — страница, с которой урок открывается без номера в адресе; `ready` — когда она известна.
 */
export function usePager({
  total,
  opening,
  ready,
  spread,
}: {
  total: number;
  opening: number;
  ready: boolean;
  spread: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [turn, setTurn] = useState<"next" | "prev" | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const step = spread ? 2 : 1;
  const asked = Number(params.get("p"));
  const current = Math.min(Math.max(asked ? asked - 1 : opening, 0), total - 1);
  const first = spread ? current - (current % 2) : current;
  const go = (target: number, direction: "next" | "prev") => {
    if (target < 0 || target >= total) return;
    setTurn(direction);
    // Листание не копит историю: «Назад» ведёт из урока к модулю, а не по страницам. Без номера в адресе
    // урок открывается на первой странице с невыполненным заданием.
    setParams({ p: String(target + 1) }, { replace: true });
    window.scrollTo({ top: 0 });
  };
  // Страница, на которой урок открылся, фиксируется в адресе: иначе выполненное задание перекидывало бы дальше.
  useEffect(() => {
    if (!asked && ready) setParams({ p: String(current + 1) }, { replace: true });
  }, [asked, ready, current, setParams]);
  const next = () => go(first + step, "next");
  const prev = () => go(Math.max(0, first - step), "prev");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const swipe = {
    onTouchStart: (event: React.TouchEvent) => {
      const target = event.target as HTMLElement;
      const point = event.touches[0];
      touch.current =
        target.closest("input, textarea") || scrollsSideways(target) ? null : { x: point.clientX, y: point.clientY };
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const start = touch.current;
      touch.current = null;
      if (!start) return;
      const point = event.changedTouches[0];
      const dx = point.clientX - start.x;
      const dy = point.clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) next();
      else prev();
    },
  };
  return { current, first, turn, go, next, prev, swipe };
}
