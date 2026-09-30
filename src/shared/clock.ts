import { useEffect, useState } from "react";
/** Часы приложения; доменные функции получают время параметром, а не читают его сами. В фоне стоят: от них зависят живые запросы к базе. */
export function useNow(intervalMs = 60000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "hidden") setNow(new Date());
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);
  return now;
}
