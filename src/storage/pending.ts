import type { CompactLesson } from "../sync/types";
import type { AppDatabase } from "./db";
import { zoned } from "./zone";

/** Уроки чужого снимка, которых ещё нет на устройстве: ждут установки пакета. Ключ служебный — в копию не идёт. */
export const PENDING_LESSONS_KEY = "sync:pendingLessons";

export type PendingLessons = Record<string, CompactLesson>;
/** Отложенные до обновления записи хранят урок формата 3 — со статусом вместо завершения. */
const parsePending = (raw: string | null): PendingLessons => {
  try {
    const parsed = JSON.parse(raw ?? "{}") as Record<string, CompactLesson & { status?: string }>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([id, lesson]) => [
        id,
        { id: lesson.id, completed: lesson.completed ?? lesson.status === "completed", updatedAt: lesson.updatedAt },
      ]),
    );
  } catch {
    return {};
  }
};
export const readPending = zoned(async (database: AppDatabase): Promise<PendingLessons> =>
  parsePending((await database.meta.get(PENDING_LESSONS_KEY))?.value ?? null),
);
