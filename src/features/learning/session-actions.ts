import Dexie from "dexie";
import { makeSession } from "../../domain/learning";
import { hasVoiceFor } from "../../shared/audio";
import type { LearningRef, Session } from "../../domain/types";
import { homeCourse, primaryCourse } from "../../storage/courses";
import { db, type AppDatabase } from "../../storage/db";
import { dexieSource } from "../../storage/queries";

const isPractice = (session: Session) => session.items.every((item) => item.mode === "practice");

/**
 * Сессия собирается из выборок базы: содержимое читается только для выбранных карточек. Новая тренировка закрывает
 * прежние незаконченные тренировки курса — иначе двойное нажатие оставит висеть «Повторение не закончено».
 */
export async function startSession(
  now: Date,
  options: { refs?: LearningRef[]; mode?: "scheduled" | "practice"; courseId?: string } = {},
  database: AppDatabase = db,
): Promise<Session | null> {
  const session = await makeSession({ source: dexieSource(database), now, hasVoice: hasVoiceFor, ...options });
  if (!session.items.length) return null;
  // Занятие прежней версии без курса — занятие домашнего курса, как в `activeSession`.
  const home = await homeCourse(database);
  const courseOf = (entry: Session) => entry.courseId ?? home;
  await database.transaction("rw", database.sessions, async () => {
    if (isPractice(session))
      await database.sessions
        .where("[status+createdAt]")
        .between(["active", Dexie.minKey], ["active", Dexie.maxKey])
        .filter((other) => courseOf(other) === courseOf(session) && isPractice(other))
        .modify({ status: "ended" });
    await database.sessions.add(session);
  });
  return session;
}

/** Адрес занятия курса: у основного курса — прежний `/session`, у остальных — с курсом в адресе. */
export async function sessionPath(courseId: string | undefined): Promise<string> {
  if (!courseId || courseId === (await primaryCourse())) return "/session";
  return `/session?course=${encodeURIComponent(courseId)}`;
}
