import { useEffect, useState } from "react";

export interface OfflineStatus {
  ready: boolean;
  checking: boolean;
  persisted: boolean;
  usage: number;
  quota: number;
  problem: string;
  /** WebView без service worker или Cache API: работа онлайн доступна, офлайн-кеш — нет. */ unsupported: boolean;
}
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Готово офлайн показываем только после реальной проверки кеша и места, без ложного обещания. */
export function useOfflineStatus(): OfflineStatus {
  const [status, setStatus] = useState<OfflineStatus>({
    ready: false,
    checking: true,
    persisted: false,
    usage: 0,
    quota: 0,
    problem: "",
    unsupported: false,
  });
  useEffect(() => {
    let alive = true;
    // Каждый API проверяется отдельно: недоступный storage или service worker не мешает работе онлайн.
    const attempt = async <T>(run: () => Promise<T> | T | undefined, fallback: T): Promise<T> => {
      try {
        return (await run()) ?? fallback;
      } catch {
        return fallback;
      }
    };
    void (async () => {
      try {
        const persisted = await attempt(() => navigator.storage?.persisted?.(), false);
        const granted = persisted || (await attempt(() => navigator.storage?.persist?.(), false));
        const estimate = await attempt(() => navigator.storage?.estimate?.(), { usage: 0, quota: 0 });
        const swSupported = "serviceWorker" in navigator && typeof caches !== "undefined";
        const registration = swSupported
          ? await attempt(() => navigator.serviceWorker.getRegistration(), undefined)
          : undefined;
        const names = swSupported ? await attempt(() => caches.keys(), []) : [];
        const counts = await Promise.all(
          names.map((name) => attempt(async () => (await (await caches.open(name)).keys()).length, 0)),
        );
        const cached = sum(counts);
        const usage = estimate.usage ?? 0,
          quota = estimate.quota ?? 0;
        const low = quota > 0 && quota - usage < 10 * 1024 * 1024;
        if (!alive) return;
        setStatus({
          ready: !!registration?.active && cached > 0,
          checking: false,
          persisted: granted,
          usage,
          quota,
          unsupported: !swSupported,
          problem: low ? "На устройстве мало места — офлайн-пакет и копии могут не сохраниться." : "",
        });
      } catch (error) {
        if (alive)
          setStatus({
            ready: false,
            checking: false,
            persisted: false,
            usage: 0,
            quota: 0,
            unsupported: false,
            problem: error instanceof Error ? error.message : "Не удалось проверить офлайн-режим",
          });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return status;
}
export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
/** Размер пакета: килобайты до мегабайта, чтобы маленький урок не показывался как «0.0 МБ». */
export const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : megabytes(bytes);
