import { makeSession } from "../../domain/learning";
import { hasVoiceFor } from "../../shared/audio";
import type { LearningRef, Session } from "../../domain/types";
import { primaryCourse } from "../../storage/courses";
import { db } from "../../storage/db";
import { dexieSource } from "../../storage/queries";

/** Сессия собирается из выборок базы: содержимое читается только для выбранных карточек. */
export async function startSession(
  now: Date,
  options: { refs?: LearningRef[]; mode?: "scheduled" | "practice"; courseId?: string } = {},
): Promise<Session | null> {
  const session = await makeSession({ source: dexieSource(), now, hasVoice: hasVoiceFor, ...options });
  if (!session.items.length) return null;
  await db.sessions.add(session);
  return session;
}

/** Адрес занятия курса: у основного курса — прежний `/session`, у остальных — с курсом в адресе. */
export async function sessionPath(courseId: string | undefined): Promise<string> {
  if (!courseId || courseId === (await primaryCourse())) return "/session";
  return `/session?course=${encodeURIComponent(courseId)}`;
}
