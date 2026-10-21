import Dexie from "dexie";
import { makeSession } from "../../domain/learning";
import { hasVoiceFor } from "../../shared/audio";
import type { LearningRef, Session } from "../../domain/types";
import { homeCourse, sessionLanguage } from "../../storage/courses";
import { sessionHomeLanguage } from "../../storage/today";
import { db, type AppDatabase } from "../../storage/db";
import { dexieSource } from "../../storage/queries";

const isPractice = (session: Session) => session.items.every((item) => item.mode === "practice");

/**
 * Сессия собирается из выборок базы: содержимое читается только для выбранных карточек. Новая тренировка закрывает
 * прежние незаконченные тренировки курса — иначе двойное нажатие оставит висеть «Повторение не закончено».
 */
export async function startSession(
  now: Date,
  options: { refs?: LearningRef[]; mode?: "scheduled" | "practice"; courseId?: string; courseIds?: string[] } = {},
  database: AppDatabase = db,
): Promise<Session | null> {
  const session = await makeSession({ source: dexieSource(database), now, hasVoice: hasVoiceFor, ...options });
  if (!session.items.length) return null;
  // Занятие прежней версии без курса — занятие домашнего курса, как в `sessionCourse`.
  const home = await homeCourse(database);
  const courseOf = (entry: Session) => entry.courseId ?? home;
  const planned = !options.refs && !isPractice(session) && !!session.language;
  return database.transaction("rw", database.sessions, async () => {
    const active = database.sessions
      .where("[status+createdAt]")
      .between(["active", Dexie.minKey], ["active", Dexie.maxKey]);
    // Два нажатия «Повторить» подряд собирают занятие дважды: второе продолжает уже начатое занятие языка.
    const started =
      planned && (await active.filter((other) => other.language === session.language && !isPractice(other)).last());
    if (started) return started;
    if (isPractice(session))
      await active
        .filter((other) => courseOf(other) === courseOf(session) && isPractice(other))
        .modify({ status: "ended" });
    await database.sessions.add(session);
    return session;
  });
}

/** Адрес занятия: у языка «Сегодня» — прежний `/session`, у других языков — с языком в адресе. */
export async function sessionPath(session: Pick<Session, "courseId" | "language">): Promise<string> {
  const [language, home] = await Promise.all([sessionLanguage(session), sessionHomeLanguage()]);
  return language === home ? "/session" : `/session?language=${language}`;
}
