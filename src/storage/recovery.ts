import { db, type LexiDatabase } from "./db";

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
export function isStorageError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const { name, inner } = error as { name?: unknown; inner?: unknown };
  if (typeof name === "string" && STORAGE_ERRORS.has(name)) return true;
  return isStorageError(inner, depth + 1);
}

export async function reopenDatabase(database: LexiDatabase = db): Promise<void> {
  database.close({ disableAutoOpen: false });
  await database.open();
}

export interface HealerOptions {
  reopen?: () => Promise<void>;
  onRecovered?: (attempt: number) => void;
  now?: () => number;
}
/**
 * Лечение отказов хранилища вне дерева React: там, где нет границы ошибок, задача сама спрашивает,
 * лечится ли отказ. Ответ «да» означает переоткрытую базу и разрешение повторить работу; «нет» —
 * отказ не от хранилища, попытки исчерпаны или переоткрыть не удалось, и о нём пора сообщать.
 */
export function storageHealer(options: HealerOptions = {}): (error: unknown) => Promise<boolean> {
  const { reopen = () => reopenDatabase(), onRecovered, now = Date.now } = options;
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
    return true;
  };
}
