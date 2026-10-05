import type { AppDatabase } from "../../src/storage/db";
import { announceChange, markChanged } from "../../src/storage/ops";

/** Локальное изменение без содержимого: устройство помечено изменённым и опубликует свою версию. */
export async function localChange(database: AppDatabase) {
  await markChanged(database);
  announceChange();
}
