// Кэш сводок: живые запросы курса перезапускаются на каждом ответе, а пакеты весят мегабайты.
import type { LessonKind } from "../content/course";
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
  module?: { id: string; position: number };
  readings: string[];
  media: string[];
}

const outlineOf = (pack: InstalledPackage): LessonOutline => ({
  kind: pack.kind,
  course: !!pack.blocks,
  tasks: taskIds(pack.blocks ?? []),
  skills: skillTasks(pack.blocks ?? []),
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
