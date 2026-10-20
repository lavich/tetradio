import { syncEvents } from "../sync/events";
import { db, type AppDatabase } from "./db";
import { readPauses, writePauses } from "./pauses";

/**
 * Даты паузы и возврата — по часам устройства; время изменения не раньше известной записи + 1 мс: часы устройства
 * могут отставать от записи, пришедшей с другого, а новое изменение должно её перекрыть.
 */
async function setPause(courseId: string, paused: boolean, now: Date, database: AppDatabase) {
  await database.transaction("rw", database.meta, async () => {
    const pauses = await readPauses(database);
    const known = pauses[courseId];
    if (!!known?.pausedAt === paused) return;
    const at = now.toISOString();
    const updatedAt = new Date(Math.max(now.getTime(), known ? Date.parse(known.updatedAt) + 1 : 0)).toISOString();
    pauses[courseId] = paused
      ? { pausedAt: at, resumedAt: null, updatedAt }
      : { pausedAt: null, resumedAt: at, updatedAt };
    await writePauses(database, pauses);
  });
  syncEvents.emit("changed");
}
export const pauseCourse = (courseId: string, now = new Date(), database: AppDatabase = db) =>
  setPause(courseId, true, now, database);
export const resumeCourse = (courseId: string, now = new Date(), database: AppDatabase = db) =>
  setPause(courseId, false, now, database);
