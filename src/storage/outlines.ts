// Кэш сводок: живые запросы курса перезапускаются на каждом ответе, а пакеты весят мегабайты.
import Dexie, { cmp, RangeSet, type ObservabilitySet } from "dexie";
import type { ExerciseBlock, LessonBlock, LessonKind } from "../content/course";
import { taskIds } from "../domain/course";
import { skillTasks, type SkillTask } from "../domain/progress";
import type { InstalledPackage } from "../domain/types";
import type { AppDatabase } from "./db";
import { zoned } from "./zone";

export interface LessonOutline {
  kind?: LessonKind;
  course: boolean;
  tasks: string[];
  skills: SkillTask[];
  mistakes: Set<string>;
  module?: { id: string; position: number };
  readings: string[];
  media: string[];
}

/** Задания к чтению и аудированию без текста не решить: их пункты в повторение не идут. */
export const reviewable = (block: LessonBlock): block is ExerciseBlock => block.type === "exercise" && !block.about;
export const mistakeId = (lessonId: string, blockId: string, itemId: string) => `${lessonId}/${blockId}/${itemId}`;
export const mistakeIdsOf = (lessonId: string, blocks: LessonBlock[] = []) =>
  blocks.filter(reviewable).flatMap((block) => block.items.map((item) => mistakeId(lessonId, block.id, item.id)));

const outlineOf = (pack: InstalledPackage): LessonOutline => ({
  kind: pack.kind,
  course: !!pack.blocks,
  tasks: taskIds(pack.blocks ?? []),
  skills: skillTasks(pack.blocks ?? []),
  mistakes: new Set(mistakeIdsOf(pack.lessonId, pack.blocks)),
  module: pack.module,
  readings: (pack.readings ?? []).map((reading) => reading.id),
  media: pack.media.map((item) => item.id),
});

interface Cache {
  database: AppDatabase;
  outlines: Map<string, LessonOutline>;
  generation: number;
  changed: Map<string, number>;
  cleared: number;
}
const caches = new Map<string, Cache>();
const PACKAGES_PART = /^idb:\/\/(.+)\/packages\/$/;

// Событие приходит и об изменениях из соседних вкладок.
Dexie.on("storagemutated", (parts: ObservabilitySet) => {
  for (const [part, ranges] of Object.entries(parts)) {
    if (!part.startsWith("idb://")) {
      caches.clear();
      return;
    }
    const cache = caches.get(PACKAGES_PART.exec(part)?.[1] ?? "");
    if (!cache) continue;
    const generation = ++cache.generation;
    for (const range of RangeSet(ranges)) {
      if (typeof range.from === "string" && cmp(range.from, range.to) === 0) {
        cache.outlines.delete(range.from);
        cache.changed.set(range.from, generation);
      } else {
        cache.outlines.clear();
        cache.cleared = generation;
        break;
      }
    }
  }
});

function cacheOf(database: AppDatabase): Cache {
  const known = caches.get(database.name);
  if (known?.database === database) return known;
  const fresh: Cache = { database, outlines: new Map(), generation: 0, changed: new Map(), cleared: 0 };
  caches.set(database.name, fresh);
  return fresh;
}

export const lessonOutlines = zoned(async function lessonOutlines(
  ids: string[],
  database: AppDatabase,
): Promise<(LessonOutline | undefined)[]> {
  // Сброс приходит после фиксации, а транзакция записи видит свои незафиксированные пакеты.
  if (Dexie.currentTransaction?.mode === "readwrite")
    return (await database.packages.bulkGet(ids)).map((pack) => pack && outlineOf(pack));
  const cache = cacheOf(database);
  const start = cache.generation;
  // Ключи, а не пакеты: так запрос подписан на эти уроки и перезапустится, когда пакет сменится.
  const present = new Set((await database.packages.where("lessonId").anyOf(ids).primaryKeys()) as string[]);
  const outlines = new Map<string, LessonOutline>();
  const missing: string[] = [];
  for (const id of present) {
    const cached = cache.outlines.get(id);
    if (cached) outlines.set(id, cached);
    else missing.push(id);
  }
  if (missing.length) {
    const read = (await database.packages.bulkGet(missing)).flatMap((pack) =>
      pack ? [[pack.lessonId, outlineOf(pack)] as const] : [],
    );
    for (const [id, outline] of read) {
      outlines.set(id, outline);
      // Пакет, изменённый во время чтения, мог прочитаться прежним: такую сводку не запоминаем.
      if (Math.max(cache.cleared, cache.changed.get(id) ?? 0) <= start) cache.outlines.set(id, outline);
    }
  }
  return ids.map((id) => outlines.get(id));
});
