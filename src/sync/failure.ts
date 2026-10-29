import type { SyncErrorKind } from "./transport";

type Report = (error: unknown, kind: SyncErrorKind | "unknown") => void;

/**
 * Клиент без облака и отключённый транспорт — штатные состояния, не сбои. Упавший вызов хранилища повторяется
 * каждые 30 с и при возврате в приложение: в отчёты он уходит один раз за запуск на каждую причину.
 */
export function syncFailureReporter(report: Report): Report {
  const reported = new Set<string>();
  return (error, kind) => {
    if (kind === "disabled" || kind === "unavailable") return;
    if (kind === "bridge") {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
      if (reported.has(cause)) return;
      reported.add(cause);
    }
    report(error, kind);
  };
}
