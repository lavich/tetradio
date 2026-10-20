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

const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());
/** Время приводится к ISO: сравнение строк при слиянии должно совпадать на всех устройствах. */
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
        ? [
            [
              courseId,
              { pausedAt: iso(pause.pausedAt), resumedAt: iso(pause.resumedAt), updatedAt: iso(pause.updatedAt)! },
            ],
          ]
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

export const isPaused = (pause: CoursePause | undefined): pause is CoursePause & { pausedAt: string } =>
  !!pause?.pausedAt;
export const writePauses = (database: AppDatabase, pauses: CoursePauses) =>
  database.meta.put({ key: COURSE_PAUSES_KEY, value: JSON.stringify(pauses) });
