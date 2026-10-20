import { syncEvents } from "../sync/events";
import { db, type AppDatabase } from "./db";
import { PAUSES_MARK_KEY, readPauses, writePauses } from "./pauses";

let marks = 0;
const markPauses = (database: AppDatabase) =>
  database.meta.put({
    key: PAUSES_MARK_KEY,
    value: `${Date.now().toString(36)}-${(++marks).toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  });

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
    await markPauses(database);
  });
  syncEvents.emit("changed");
}
export const pauseCourse = (courseId: string, now = new Date(), database: AppDatabase = db) =>
  setPause(courseId, true, now, database);
export const resumeCourse = (courseId: string, now = new Date(), database: AppDatabase = db) =>
  setPause(courseId, false, now, database);
