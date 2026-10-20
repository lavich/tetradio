import { syncEvents } from "../sync/events";
import { db, type AppDatabase } from "./db";
import { zoned } from "./zone";

export const COURSE_PAUSES_KEY = "coursePauses";
/**
 * Отметка «паузы курсов ещё не опубликованы». Отдельно от `sync:dirty`: пауза сливается сама и не должна вызывать
 * окно выбора версии, где выбор «Это устройство» стёр бы ответы другого устройства.
 */
export const PAUSES_MARK_KEY = "sync:pauses";

/** Пауза курса: `pausedAt` задан — курс на паузе; после возврата запись остаётся с `resumedAt` — границей долга. */
export interface CoursePause {
  pausedAt: string | null;
  resumedAt: string | null;
  updatedAt: string;
}
export type CoursePauses = Record<string, CoursePause>;

const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isTimeOrNull = (value: unknown) => value === null || isTime(value);
export const isPause = (value: unknown): value is CoursePause => {
  const pause = value as CoursePause;
  return !!pause && isTime(pause.updatedAt) && isTimeOrNull(pause.pausedAt) && isTimeOrNull(pause.resumedAt);
};

export function parsePauses(raw: string | null | undefined): CoursePauses {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([courseId, pause]) =>
      isPause(pause)
        ? [[courseId, { pausedAt: pause.pausedAt, resumedAt: pause.resumedAt, updatedAt: pause.updatedAt }]]
        : [],
    ),
  );
}

/** Более поздняя запись; при равном времени — с большей строкой JSON, чтобы все устройства выбрали одну и ту же. */
export function laterPause(a: CoursePause | undefined, b: CoursePause | undefined): CoursePause | undefined {
  if (!a || !b) return a ?? b;
  const at = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (at) return at > 0 ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
export function mergePauses(...lists: (CoursePauses | undefined)[]): CoursePauses {
  const merged: CoursePauses = {};
  for (const list of lists)
    for (const [courseId, pause] of Object.entries(list ?? {})) merged[courseId] = laterPause(merged[courseId], pause)!;
  return merged;
}
export const samePause = (a: CoursePause | undefined, b: CoursePause | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const readPauses = zoned(async (database: AppDatabase = db): Promise<CoursePauses> =>
  parsePauses((await database.meta.get(COURSE_PAUSES_KEY))?.value),
);
export const writePauses = (database: AppDatabase, pauses: CoursePauses) =>
  database.meta.put({ key: COURSE_PAUSES_KEY, value: JSON.stringify(pauses) });

let marks = 0;
export const markPauses = (database: AppDatabase) =>
  database.meta.put({
    key: PAUSES_MARK_KEY,
    value: `${Date.now().toString(36)}-${(++marks).toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  });

export const isPaused = (pause: CoursePause | undefined): pause is CoursePause & { pausedAt: string } =>
  !!pause?.pausedAt;

/** Часы устройства могут отставать от записи, пришедшей с другого: новое изменение всё равно позже известного. */
async function setPause(courseId: string, paused: boolean, now: Date, database: AppDatabase) {
  await database.transaction("rw", database.meta, async () => {
    const pauses = await readPauses(database);
    const known = pauses[courseId];
    if (!!known?.pausedAt === paused) return;
    const at = new Date(Math.max(now.getTime(), known ? Date.parse(known.updatedAt) + 1 : 0)).toISOString();
    pauses[courseId] = paused
      ? { pausedAt: at, resumedAt: null, updatedAt: at }
      : { pausedAt: null, resumedAt: at, updatedAt: at };
    await writePauses(database, pauses);
    await markPauses(database);
  });
  syncEvents.emit("changed");
}
export const pauseCourse = (courseId: string, now = new Date(), database: AppDatabase = db) =>
  setPause(courseId, true, now, database);
export const resumeCourse = (courseId: string, now = new Date(), database: AppDatabase = db) =>
  setPause(courseId, false, now, database);
