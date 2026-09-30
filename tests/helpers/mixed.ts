import type { LexiDatabase } from "../../src/storage/db";
import { installLesson, refreshCatalog } from "../../src/content/client";
import { memoryFetcher } from "./content";
import { MIXED_LESSON, mixedContent } from "./mixed-fixture";

/** Фикстура смешанного урока без зависимостей клиента лежит в mixed-fixture.ts (её читают и браузерные тесты). */
export * from "./mixed-fixture";
/** Каталог с фикстурой и установка перечисленных уроков без сети. */
export async function installMixed(db: LexiDatabase, ids: string[] = [MIXED_LESSON], content = mixedContent()) {
  const fetcher = memoryFetcher(content);
  await refreshCatalog(db, fetcher);
  for (const id of ids) await installLesson(id, db, fetcher);
  return fetcher;
}
