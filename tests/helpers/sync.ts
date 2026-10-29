import type { AppDatabase } from "../../src/storage/db";
import { ANCESTOR_PREFIX, ANCESTORS } from "../../src/sync/ancestors";

/** Конфликт без общего предка: цепочка снята, как у первого обмена после обновления. */
export async function forgetAncestors(database: AppDatabase) {
  const keys = (await database.meta.toCollection().primaryKeys()) as string[];
  await database.meta.bulkDelete(keys.filter((key) => key === ANCESTORS || key.startsWith(ANCESTOR_PREFIX)));
}
