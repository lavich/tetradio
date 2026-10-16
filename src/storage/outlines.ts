// Кэш сводок: живые запросы курса перезапускаются на каждом ответе, а пакеты весят мегабайты.
import type { ExerciseBlock, LessonBlock, LessonKind } from "../content/course";
import { taskIds } from "../domain/course";
import { skillTasks, type SkillTask } from "../domain/progress";
import type { InstalledPackage } from "../domain/types";
import type { AppDatabase } from "./db";
import { rowCache } from "./row-cache";
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

const outlines = rowCache<LessonOutline>("packages");

export const lessonOutlines = zoned(async function lessonOutlines(
  ids: string[],
  database: AppDatabase,
): Promise<(LessonOutline | undefined)[]> {
  // Ключи, а не пакеты: так запрос подписан на эти уроки и перезапустится, когда пакет сменится.
  const present = (await database.packages.where("lessonId").anyOf(ids).primaryKeys()) as string[];
  const read = await outlines(present, database, async (keys) =>
    (await database.packages.bulkGet(keys)).map((pack) => pack && outlineOf(pack)),
  );
  const byId = new Map(present.map((id, index) => [id, read[index]]));
  return ids.map((id) => byId.get(id));
});
