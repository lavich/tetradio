import { db, type AppDatabase } from "../storage/db";
import type { Asset } from "../domain/types";
import { fetcher, type ContentFetcher } from "./fetcher";
import { toContentError } from "./install";
import { ContentError } from "./schema";

const mediaInflight = new Map<string, Promise<Asset | null>>();
export function ensureAsset(
  id: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<Asset | null> {
  const running = mediaInflight.get(id);
  if (running) return running;
  const task = (async () => {
    try {
      const stored = await database.assets.get(id);
      if (stored) return stored;
      const ref = await database.media.get(id);
      if (!ref) return null;
      const blob = await source.blob(ref.url);
      if (blob.size !== ref.bytes) throw new ContentError(`Файл ${ref.url} повреждён: размер не совпадает.`);
      if (ref.mimeType === "image/svg+xml" && !(await blob.text()).includes("<svg"))
        throw new ContentError(`Файл ${ref.url} повреждён: это не SVG.`);
      const asset: Asset = {
        id,
        kind: ref.kind,
        blob: new Blob([blob], { type: ref.mimeType }),
        mimeType: ref.mimeType,
        source: ref.source,
        alt: ref.alt,
      };
      await database.assets.put(asset);
      return asset;
    } finally {
      mediaInflight.delete(id);
    }
  })();
  mediaInflight.set(id, task);
  return task;
}

export interface Readiness {
  installed: boolean;
  version: string | null;
  updateAvailable: boolean;
  required: number;
  present: number;
  missing: string[];
}
export async function lessonReadiness(lessonId: string, database: AppDatabase = db): Promise<Readiness> {
  const [pack, entry] = await Promise.all([database.packages.get(lessonId), database.catalog.get(lessonId)]);
  if (!pack) return { installed: false, version: null, updateAvailable: false, required: 0, present: 0, missing: [] };
  const required = pack.media.filter((item) => item.required);
  const present = await database.assets
    .where("id")
    .anyOf(required.map((item) => item.id))
    .primaryKeys();
  const have = new Set(present);
  return {
    installed: true,
    version: pack.version,
    updateAvailable: !!entry && entry.version !== pack.version,
    required: required.length,
    present: present.length,
    missing: required.filter((item) => !have.has(item.id)).map((item) => item.id),
  };
}
export async function downloadLessonMedia(
  lessonId: string,
  database: AppDatabase = db,
  source: ContentFetcher = fetcher,
): Promise<{ fetched: number; failed: string[] }> {
  const readiness = await lessonReadiness(lessonId, database);
  let fetched = 0;
  const failed: string[] = [];
  for (const id of readiness.missing) {
    try {
      if (await ensureAsset(id, database, source)) fetched++;
      else failed.push(id);
    } catch (error) {
      if (toContentError(error).kind === "storage") throw toContentError(error);
      failed.push(id);
    }
  }
  return { fetched, failed };
}
