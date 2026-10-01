import { indexWord, type AppDatabase } from "../../src/storage/db";
import type { Word } from "../../src/domain/types";
import type { ContentFetcher } from "../../src/content/client";
import { installLesson, refreshCatalog } from "../../src/content/client";
import { buildContent, type BuiltContent } from "../../content/build";

/** Один собранный контент на весь прогон: пакеты неизменяемы, а сборка стоит дороже теста. */
export const content: BuiltContent = buildContent("tests/fixtures/mechanics");

/** Источник контента в памяти: тесты устанавливают пакеты без сети и подменяют файлы для сценариев ошибок. */
export function memoryFetcher(
  built: BuiltContent = content,
  overrides: Record<string, unknown> = {},
): ContentFetcher & { requests: string[] } {
  const files = new Map(built.files.map((file) => [file.path, file]));
  const requests: string[] = [];
  const body = (url: string) => {
    requests.push(url);
    if (url in overrides) return overrides[url];
    const file = files.get(url);
    if (!file) throw Object.assign(new Error(`404 ${url}`), { name: "NotFound" });
    return file.body;
  };
  return {
    requests,
    json: async (url) => {
      const raw = body(url);
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    },
    blob: async (url) => {
      const raw = body(url);
      return raw instanceof Blob ? raw : new Blob([raw as BlobPart], { type: files.get(url)?.mimeType });
    },
  };
}
/** Каталог плюс установка перечисленных уроков — замена старого `ensureSeed()` в тестах. */
export async function installLessons(db: AppDatabase, ids: string[], fetcher = memoryFetcher()) {
  await refreshCatalog(db, fetcher);
  for (const id of ids) await installLesson(id, db, fetcher);
  return fetcher;
}
export const packageOf = (id: string) => content.packages.find((pack) => pack.id === id)!;
export const wordsOf = (id: string) => {
  const pack = packageOf(id);
  return pack.links.map((link) => pack.words.find((word) => word.id === link.wordId)!);
};
/** Сколько уникальных слов дают перечисленные уроки: одно слово в двух уроках считается один раз. */
export const wordCountOf = (...ids: string[]) =>
  new Set(ids.flatMap((id) => packageOf(id).words.map((word) => word.id))).size;
/** Сколько связей «урок — карточка» дают перечисленные уроки: карточки всех видов. */
export const itemCountOf = (...ids: string[]) => ids.reduce((sum, id) => sum + packageOf(id).items.length, 0);

/** Правка слова из профиля прежней версии с редактором: такие записи приходят из старых копий и синхронизации. */
export async function legacyEdit(database: AppDatabase, id: string, patch: Partial<Word>) {
  const word = (await database.words.get(id))!;
  await database.words.put(indexWord({ ...word, ...patch, edited: true }));
}
