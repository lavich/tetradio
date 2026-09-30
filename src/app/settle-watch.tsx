import { useEffect, useRef } from "react";
import { localDay, localHour } from "../domain/learning";

/**
 * Сторож рубежа подготовки в открытом приложении: наблюдаемое значение — пара «день и местный час»,
 * потому что рубеж зависит и от часа занятия курса. Первый рендер пропускается — закрепление при
 * старте уже сделал `main.tsx`.
 */
export function useSettleWatch(now: Date, timezone: string, settle: () => void) {
  const stamp = `${localDay(now, timezone)}T${localHour(now, timezone)}`;
  const seen = useRef(stamp);
  const run = useRef(settle);
  run.current = settle;
  useEffect(() => {
    if (seen.current === stamp) return;
    seen.current = stamp;
    run.current();
  }, [stamp]);
}
