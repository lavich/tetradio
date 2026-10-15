import { reportError } from "../reporting/reporting";
import { db, type AppDatabase } from "./db";

/** Ошибки хранилища, которые лечит переоткрытие базы: WebKit после сна WebView отдаёт `UnknownError` на чтение IndexedDB. */
const STORAGE_ERRORS = new Set([
  "UnknownError",
  "InvalidStateError",
  "TransactionInactiveError",
  "AbortError",
  "DatabaseClosedError",
]);
/** Предел лечения: дальше отказ признаётся невылеченным и уходит в отчёт. Общий для границы интерфейса и фоновых задач. */
export const RECOVERY_ATTEMPTS = 3,
  RECOVERY_WINDOW_MS = 60000;
function named(error: unknown, names: Set<string>, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const { name, inner } = error as { name?: unknown; inner?: unknown };
  if (typeof name === "string" && names.has(name)) return true;
  return named(inner, names, depth + 1);
}
export const isStorageError = (error: unknown) => named(error, STORAGE_ERRORS);
/** Неактивная транзакция бывает и после сна WebView, и от ошибки кода: лечится, но отчёт уходит — раз за запуск. */
const SUSPECT_ERRORS = new Set(["TransactionInactiveError"]);
export function suspectReporter(report: (error: unknown) => void): (error: unknown) => void {
  let sent = false;
  return (error) => {
    if (sent || !named(error, SUSPECT_ERRORS)) return;
    sent = true;
    report(error);
  };
}
export const reportHealedSuspect = suspectReporter((error) =>
  reportError(error, { category: "storage", extra: { kind: "healed" } }),
);

export async function reopenDatabase(database: AppDatabase = db): Promise<void> {
  database.close({ disableAutoOpen: false });
  await database.open();
}

export interface HealerOptions {
  reopen?: () => Promise<void>;
  onRecovered?: (attempt: number) => void;
  onHealed?: (error: unknown) => void;
  now?: () => number;
}
/**
 * Лечение отказов хранилища вне дерева React: там, где нет границы ошибок, задача сама спрашивает,
 * лечится ли отказ. Ответ «да» означает переоткрытую базу и разрешение повторить работу; «нет» —
 * отказ не от хранилища, попытки исчерпаны или переоткрыть не удалось, и о нём пора сообщать.
 */
export function storageHealer(options: HealerOptions = {}): (error: unknown) => Promise<boolean> {
  const { reopen = () => reopenDatabase(), onRecovered, onHealed = reportHealedSuspect, now = Date.now } = options;
  let attempts: number[] = [];
  return async (error) => {
    if (!isStorageError(error)) return false;
    const at = now();
    attempts = attempts.filter((previous) => at - previous < RECOVERY_WINDOW_MS);
    if (attempts.length >= RECOVERY_ATTEMPTS) return false;
    attempts.push(at);
    const attempt = attempts.length;
    try {
      await reopen();
    } catch (failure) {
      console.warn("Не удалось переоткрыть локальную базу", failure);
      return false;
    }
    onRecovered?.(attempt);
    onHealed(error);
    return true;
  };
}
