import type { AppDatabase } from "../../storage/db";
import type { SyncAdapter } from "../../sync/adapter";
import { META, readMeta } from "../../sync/snapshot";

/**
 * Отпечаток облака на момент предпросмотра: указатели других устройств с их часами. Свой указатель не входит —
 * его результаты уже лежат в этой базе и уходят в защитную копию. `null` — облако недоступно или не ответило:
 * сверять не с чем, а восстановленная копия всё равно не заменит облако без выбора (`sync:restored`).
 */
export async function cloudPrint(adapter: SyncAdapter, database: AppDatabase): Promise<string | null> {
  if (!adapter.capabilities().available) return null;
  try {
    const own = await readMeta(database, META.device);
    const listing = await adapter.listPointers();
    const seen = listing.pointers
      .filter((pointer) => pointer.device !== own)
      .map((pointer) => {
        const clock = Object.keys(pointer.clock)
          .sort()
          .map((device) => `${device}=${pointer.clock[device]}`)
          .join(",");
        return `${pointer.device}:${pointer.id}:${clock}`;
      });
    return JSON.stringify([...seen.sort(), ...listing.invalid.sort()]);
  } catch {
    return null;
  }
}

export interface CloudGuard {
  /** Отпечаток, снятый при предпросмотре. */
  seen: string | null;
  read: () => Promise<string | null>;
}
export const CLOUD_CHANGED = "Данные аккаунта изменились на другом устройстве — откройте предпросмотр заново.";
export class CloudChangedError extends Error {
  constructor() {
    super(CLOUD_CHANGED);
    this.name = "CloudChangedError";
  }
}
/** Облако, доступное сейчас, обязано совпасть с увиденным при предпросмотре; недоступное не сверяется. */
export async function assertCloudUnchanged(guard: CloudGuard | undefined): Promise<void> {
  if (!guard) return;
  const now = await guard.read();
  if (now !== null && now !== guard.seen) throw new CloudChangedError();
}
