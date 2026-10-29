import type { SyncErrorKind } from "./transport";

type Report = (error: unknown, kind: SyncErrorKind | "unknown") => void;

/**
 * Клиент без облака и отключённый транспорт — штатные состояния, не сбои. Упавший вызов хранилища повторяется
 * каждые 30 с и при возврате в приложение: в отчёты он уходит один раз за запуск.
 */
export function syncFailureReporter(report: Report): Report {
  let bridgeReported = false;
  return (error, kind) => {
    if (kind === "disabled" || kind === "unavailable") return;
    if (kind === "bridge") {
      if (bridgeReported) return;
      bridgeReported = true;
    }
    report(error, kind);
  };
}
