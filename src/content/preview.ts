import { db, type AppDatabase, type StoredCatalogEntry } from "../storage/db";
import { fetcher, networkError, type ContentFetcher } from "./fetcher";
import { ContentError, parsePackage, type ContentPackage, type PackageMedia } from "./schema";

export interface PackagePreview {
  entry: StoredCatalogEntry;
  pack: ContentPackage;
}
const previews = new Map<string, Promise<PackagePreview>>();
/**
 * Пакет урока для просмотра без установки: читается и проверяется так же, как при установке,
 * но ничего не пишет в базу. Удачный результат живёт в памяти вкладки, неудачный — нет, чтобы повтор сработал.
 */
export function previewPackage(
  lessonId: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<PackagePreview> {
  const task = (async () => {
    const entry = await database.catalog.get(lessonId);
    if (!entry) throw new ContentError("Этого урока нет в каталоге.");
    const key = `${lessonId}@${entry.version}`;
    const cached = previews.get(key);
    if (cached) return cached;
    const loading = (async () => {
      const pack = parsePackage(await source.json(entry.url));
      if (pack.id !== lessonId || pack.version !== entry.version)
        throw new ContentError("Пакет не соответствует записи каталога.");
      return { entry, pack };
    })();
    previews.set(key, loading);
    loading.catch(() => previews.delete(key));
    return loading;
  })();
  // Просмотр ничего не пишет, поэтому любой сбой, кроме отклонённого пакета, — это сбой загрузки.
  return task.catch((error: unknown) => {
    throw error instanceof ContentError ? error : networkError("пакет урока");
  });
}
/** Только для тестов: забыть прочитанные пакеты. */
export const resetPreviews = () => previews.clear();
export const previewMedia = (pack: ContentPackage): Map<string, PackageMedia> =>
  new Map(pack.media.map((item) => [item.id, item]));
