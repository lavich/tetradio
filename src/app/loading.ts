import { useEffect, useState, useSyncExternalStore } from "react";

const SLOW_MS = 300;
let pending = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Навигация идёт в `startTransition`: старый экран остаётся, и `Suspense` молчит, поэтому ждущие чанки считаются здесь. */
export function trackLoading<T>(load: Promise<T>): Promise<T> {
  pending++;
  emit();
  const done = () => {
    pending--;
    emit();
  };
  load.then(done, done);
  return load;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** `true`, только если чанк грузится дольше `SLOW_MS`: быстрая загрузка ничего не показывает. */
export function useSlowLoading(delay = SLOW_MS): boolean {
  const loading = useSyncExternalStore(subscribe, () => pending > 0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return setSlow(false);
    const id = setTimeout(() => setSlow(true), delay);
    return () => clearTimeout(id);
  }, [loading, delay]);
  return loading && slow;
}
