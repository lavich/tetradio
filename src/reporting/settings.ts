import { liveQuery } from "dexie";
import { db, type LexiDatabase } from "../storage/db";
import { loadSettings } from "../storage/queries";
import { setReportingEnabled } from "./reporting";

/**
 * Настройка читается после открытия базы и дальше отслеживается живым запросом: переключатель в «Настройках»,
 * восстановление копии и синхронизация действуют немедленно, без перезапуска. Возвращает отписку.
 */
export function bindReportingToSettings(database: LexiDatabase = db): () => void {
  const subscription = liveQuery(() => loadSettings(database)).subscribe({
    next: (settings) => setReportingEnabled(settings.errorReports),
    error: (error) => console.warn("Настройка отчётов не прочитана", error),
  });
  return () => subscription.unsubscribe();
}
