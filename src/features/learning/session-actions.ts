import { makeSession } from "../../domain/learning";
import { hasGreekVoice } from "../../shared/audio";
import type { LearningRef, Session } from "../../domain/types";
import { db } from "../../storage/db";
import { dexieSource } from "../../storage/queries";

/** Сессия собирается из выборок базы: содержимое читается только для выбранных карточек. */
export async function startSession(
  now: Date,
  options: { refs?: LearningRef[]; mode?: "scheduled" | "practice" } = {},
): Promise<Session | null> {
  const session = await makeSession({ source: dexieSource(), now, hasVoice: hasGreekVoice(), ...options });
  if (!session.items.length) return null;
  await db.sessions.add(session);
  return session;
}
