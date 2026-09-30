import Dexie from "dexie";
import { db, ensureLocalCourse, indexWord, type LexiDatabase } from "./db";
import { lessonMates, optionPool, phrasePool } from "./queries";
import {
  closeSources,
  easierExercise,
  exerciseFor,
  gradeFor,
  hasEasierStep,
  localDay,
  nextState,
  NO_WORDS,
  OPTION_POOL,
  spaceSingleIntroduction,
} from "../domain/learning";
import type { TextAnswerStatus } from "../domain/text-answer";
import { normalize, wordKey, type ImportRow } from "../domain/import";
import { snapshotOf, unitKey, wordRef } from "../domain/refs";
import { emptySkills } from "../domain/skills";
import { preparedByCourse, scheduleCourses } from "../domain/schedule";
import {
  fillSettings,
  type Asset,
  type Course,
  type LearningRef,
  type Lesson,
  type ReviewEvent,
  type Session,
  type SessionItem,
  type Settings,
  type Word,
} from "../domain/types";
import { syncEvents } from "../sync/events";

/** Отметка «есть неопубликованные изменения» пишется в той же транзакции, что и само изменение. */
export const DIRTY_KEY = "sync:dirty";
const markChanged = (database: LexiDatabase) => database.meta.put({ key: DIRTY_KEY, value: "1" });
const announceChange = () => syncEvents.emit("changed");
const settled = (items: SessionItem[]) => items.filter((entry) => entry.eventId || entry.skipped).length;

export class ConflictError extends Error {
  constructor() {
    super("Карточка уже отвечена в другой вкладке. Обновите страницу.");
  }
}
const stamp = (now: Date) => now.toISOString();
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export interface AnswerInput {
  session: Session;
  item: SessionItem;
  correct: boolean;
  answer: string;
  /** Исход проверки для оценки срока; без него он выводится из `correct`, как у заданий с выбором. */
  status?: TextAnswerStatus;
  responseTimeMs: number;
  activeTimeMs: number;
  timezone: string;
  now?: Date;
  database?: LexiDatabase;
}
/** Один ответ = одно событие, один пересчёт FSRS и одна позиция сессии, в одной транзакции. */
export async function submitAnswer(input: AnswerInput): Promise<ReviewEvent> {
  return (await recordAnswer(input)).event;
}
/**
 * `created:false` — ответ уже был записан (повторное нажатие, вторая вкладка): отклик и синхронизация не повторяются.
 * Снимок содержимого и описание цели берутся из карточки сессии, а не из свежей версии пакета.
 */
export async function recordAnswer({
  session,
  item,
  correct,
  answer,
  status,
  responseTimeMs,
  activeTimeMs,
  timezone,
  now = new Date(),
  database = db,
}: AnswerInput): Promise<{ event: ReviewEvent; created: boolean }> {
  if (typeof correct !== "boolean" || item.type === "recall") throw new Error("Нужен ответ на объективное задание");
  // «Почти» приходит только из проверок с вводом текста; у заданий с выбором исход задаёт сам `correct`.
  const rating = gradeFor(status ?? (correct ? "correct" : "wrong"), item.type, responseTimeMs);
  // Ступень проще считается до транзакции: иначе запись пришлось бы расширить на таблицы слов и фраз.
  const easier = correct ? null : await easierRetry(item, session, database);
  const eventId = `e-${item.id}`;
  const result = await database.transaction(
    "rw",
    database.events,
    database.cardStates,
    database.sessions,
    database.meta,
    async () => {
      const existing = await database.events.get(eventId);
      if (existing) return { event: existing, created: false }; // повторное нажатие не создаёт второй ответ
      const state = await database.cardStates.get(item.unitKey);
      if ((state?.version ?? 0) !== item.expectedVersion) throw new ConflictError();
      // Досрочный верный ответ — слабое свидетельство памяти: карточку недавно показывали. Ошибка достоверна всегда.
      const movesSchedule = item.mode === "scheduled" || (item.mode === "preview" && !correct);
      const updated = movesSchedule ? nextState(state, item.ref, rating, now) : undefined;
      const event: ReviewEvent = {
        id: eventId,
        sessionId: session.id,
        itemId: item.id,
        ref: item.ref,
        unitKey: item.unitKey,
        snapshot: snapshotOf(item.card),
        type: item.type,
        mode: item.mode,
        rating,
        correct,
        answer,
        createdAt: stamp(now),
        localDate: localDay(now, timezone),
        responseTimeMs,
        before: state?.card,
        after: updated?.card,
      };
      await database.events.add(event);
      if (updated) await database.cardStates.put(updated);
      // Позиция сессии = сколько упражнений уже отвечено; экран сам решает, когда листать дальше.
      const stored = (await database.sessions.get(session.id)) ?? session;
      const items = stored.items.map((entry) => (entry.id === item.id ? { ...entry, eventId } : entry));
      if (!correct && !items.some((entry) => entry.retryOf && entry.unitKey === item.unitKey)) {
        const position = items.findIndex((entry) => entry.id === item.id);
        items.splice(Math.min(position + 3, items.length), 0, {
          ...item,
          ...easier,
          id: `${item.id}-retry`,
          isNew: false,
          mode: "practice",
          expectedVersion: updated?.version ?? state?.version ?? 0,
          eventId: undefined,
          retryOf: item.id,
        });
      }
      const answered = settled(items);
      await database.sessions.put({
        ...stored,
        items,
        index: answered,
        activeTimeMs,
        status: answered >= items.length ? "done" : "active",
      });
      await markChanged(database);
      return { event, created: true };
    },
  );
  if (result.created) announceChange();
  return result;
}
/**
 * Задание дополнительной попытки: ступень проще провалённой. Пул вариантов читается только на ошибке
 * и только под заданием, у которого ступень есть; `null` — попытка повторяет то же задание.
 */
async function easierRetry(
  item: SessionItem,
  session: Session,
  database: LexiDatabase,
): Promise<Pick<SessionItem, "type" | "options"> | null> {
  if (!hasEasierStep(item.type)) return null;
  const card = item.card;
  const pools =
    card.kind === "word"
      ? {
          words: await wordSourcesOf(card.word.id, session, database),
          phrases: [],
        }
      : { words: NO_WORDS, phrases: await phrasePool(OPTION_POOL, database) };
  return easierExercise(card, item.type, pools);
}
/**
 * Живые слова занятия: в элементах лежат снимки на момент сборки, поэтому слова перечитываются по id,
 * а удалённые с тех пор отбрасываются.
 */
async function liveSessionWords(session: Session, database: LexiDatabase): Promise<Word[]> {
  const ids = [...new Set(session.items.flatMap((item) => (item.card.kind === "word" ? [item.card.word.id] : [])))];
  return (await database.words.bulkGet(ids)).flatMap((word) => (word && !word.deletedAt ? [word] : []));
}
/** Источники вариантов слова в занятии: соседи по урокам, живые слова занятия и пул словаря. */
async function wordSourcesOf(wordId: string, session: Session, database: LexiDatabase) {
  const [mates, sessionWords, pool] = await Promise.all([
    lessonMates([wordId], database),
    liveSessionWords(session, database),
    optionPool(OPTION_POOL, database),
  ]);
  return closeSources(wordId, mates, sessionWords, pool);
}

/**
 * Пропуск без оценки знания: аудио недоступно или не воспроизвелось. События нет, интервалы не меняются,
 * упражнение считается пройденным для позиции занятия.
 */
export async function skipItem(
  sessionId: string,
  itemId: string,
  activeTimeMs: number,
  database: LexiDatabase = db,
): Promise<void> {
  await database.transaction("rw", database.sessions, async () => {
    const session = await database.sessions.get(sessionId);
    if (!session) throw new Error("Занятие недоступно");
    const items = session.items.map((entry) =>
      entry.id === itemId && !entry.eventId ? { ...entry, skipped: true } : entry,
    );
    const answered = settled(items);
    await database.sessions.put({
      ...session,
      items,
      index: answered,
      activeTimeMs,
      status: answered >= items.length ? "done" : "active",
    });
  });
}
export const saveSession = (session: Session, database: LexiDatabase = db) => database.sessions.put(session);
export const endSession = async (session: Session, database: LexiDatabase = db) => {
  await database.sessions.put({ ...session, status: session.index >= session.items.length ? "done" : "ended" });
};

/** Правка поставленного слова помечается локальной: обновление пакета её не перезапишет. */
export async function saveWord(word: Word, database: LexiDatabase = db) {
  const previous = await database.words.get(word.id);
  const greekChanged = previous && normalize(previous.greek) !== normalize(word.greek);
  const edited = (previous?.revision ?? word.revision) ? true : word.edited;
  await database.words.put(
    indexWord({
      ...word,
      verified: greekChanged ? false : word.verified,
      updatedAt: stamp(new Date()),
      ...(edited ? { edited } : {}),
    }),
  );
}
/** Мягкое удаление: история ответов остаётся достоверной. */
export async function deleteWord(id: string, database: LexiDatabase = db) {
  await database.words.update(id, { deletedAt: stamp(new Date()) });
}
export type LessonPatch = Partial<Pick<Lesson, "title" | "targetDate" | "status">>;
/** Частичная правка сырой записи: вычисленная по расписанию дата из снимка не попадает в базу. */
export async function updateLesson(id: string, patch: LessonPatch, database: LexiDatabase = db) {
  await database.transaction("rw", database.lessons, database.meta, async () => {
    await database.lessons.update(id, { ...patch, updatedAt: stamp(new Date()) });
    await markChanged(database);
  });
  announceChange();
}
/** Для поставленного урока удаление связи запоминается, чтобы обновление пакета её не вернуло. Карточка, прогресс и история остаются. */
export async function removeFromLesson(lessonId: string, ref: LearningRef, database: LexiDatabase = db) {
  const key = unitKey(ref);
  await database.transaction(
    "rw",
    database.lessons,
    database.lessonItems,
    database.packages,
    database.meta,
    async () => {
      await database.lessonItems.delete([lessonId, key]);
      const pack = await database.packages.get(lessonId);
      if (pack && !pack.removed.includes(key))
        await database.packages.put({ ...pack, removed: [...pack.removed, key] });
      await updateLesson(lessonId, {}, database);
    },
  );
}
export async function linkCards(lessonId: string, refs: LearningRef[], database: LexiDatabase = db): Promise<number> {
  const existing = await database.lessonItems
    .where("[lessonId+position]")
    .between([lessonId, Dexie.minKey], [lessonId, Dexie.maxKey])
    .toArray();
  const known = new Set(existing.map((link) => link.unitKey));
  let position = existing.reduce((max, link) => Math.max(max, link.position + 1), 0);
  const fresh = refs.filter((ref) => {
    const key = unitKey(ref);
    return !known.has(key) && known.add(key);
  });
  await database.lessonItems.bulkAdd(
    fresh.map((ref) => ({ lessonId, unitKey: unitKey(ref), ref, position: position++ })),
  );
  return fresh.length;
}
export const linkWords = (lessonId: string, wordIds: string[], database: LexiDatabase = db) =>
  linkCards(lessonId, wordIds.map(wordRef), database);
/** Новый набор без даты: её назначит расписание, а своя дата задаётся на экране урока. */
export async function createLesson(title: string, database: LexiDatabase = db): Promise<Lesson> {
  const now = stamp(new Date());
  const lesson: Lesson = {
    id: newId("lesson"),
    courseId: await ensureLocalCourse(database),
    title,
    targetDate: null,
    status: "upcoming",
    createdAt: now,
    updatedAt: now,
  };
  await database.lessons.add(lesson);
  return lesson;
}
/**
 * Урок, чей день по расписанию уже прошёл, становится проведённым, а дата — его собственной,
 * поэтому дальнейшие изменения расписания его не трогают. Повторный вызов ничего не пишет.
 */
export async function settleLessons(now: Date, database: LexiDatabase = db): Promise<number> {
  return database.transaction("rw", database.lessons, database.courses, database.settings, database.meta, async () => {
    const settings = fillSettings(await database.settings.get("settings"));
    const stored = await database.lessons.toArray();
    const raw = new Map(stored.map((lesson) => [lesson.id, lesson]));
    const courses = await database.courses.toArray();
    const prepared = preparedByCourse(courses, now, settings.timezone);
    const passed = scheduleCourses(stored, courses).filter(
      (lesson) =>
        lesson.targetDate &&
        lesson.targetDate <= prepared(lesson.courseId) &&
        (raw.get(lesson.id)!.status !== "completed" || !raw.get(lesson.id)!.targetDate),
    );
    for (const lesson of passed)
      await updateLesson(lesson.id, { targetDate: lesson.targetDate, status: "completed" }, database);
    return passed.length;
  });
}
export async function putAsset(asset: Asset, database: LexiDatabase = db) {
  await database.assets.put(asset);
}

export interface ImportPlan {
  rows: ImportRow[];
  lessonId: string | null;
  lessonTitle: string;
}
export interface ImportOutcome {
  lessonId: string;
  added: number;
  linked: number;
  conflicts: number;
}
export async function commitImport(plan: ImportPlan, database: LexiDatabase = db): Promise<ImportOutcome> {
  const now = stamp(new Date());
  return database.transaction(
    "rw",
    database.words,
    database.lessons,
    database.lessonItems,
    database.courses,
    async () => {
      const lesson = plan.lessonId
        ? await database.lessons.get(plan.lessonId)
        : {
            id: newId("lesson"),
            courseId: await ensureLocalCourse(database),
            title: plan.lessonTitle,
            targetDate: null,
            status: "upcoming" as const,
            createdAt: now,
            updatedAt: now,
          };
      if (!lesson) throw new Error("Набор не найден");
      const wordIds: string[] = [];
      let added = 0,
        conflicts = 0;
      for (const row of plan.rows) {
        const known = await database.words
          .where("key")
          .equals(wordKey(row.greek, row.russian))
          .filter((word) => !word.deletedAt)
          .first();
        if (known) {
          if (!wordIds.includes(known.id)) wordIds.push(known.id);
          continue;
        }
        if (
          await database.words
            .where("greekKey")
            .equals(normalize(row.greek))
            .filter((word) => !word.deletedAt)
            .count()
        )
          conflicts++;
        const word: Word = {
          id: newId("w"),
          greek: row.greek,
          russian: row.russian,
          ipa: row.ipa,
          segments: [],
          examples: [],
          verified: false,
          source: row.ipa ? "Импорт пользователя (фонетика не проверена)" : undefined,
          createdAt: now,
          updatedAt: now,
        };
        await database.words.add(indexWord(word));
        wordIds.push(word.id);
        added++;
      }
      await database.lessons.put({ ...lesson, updatedAt: now });
      const linked = await linkWords(lesson.id, wordIds, database);
      return { lessonId: lesson.id, added, linked: linked - added, conflicts };
    },
  );
}
export async function saveSettings(settings: Settings, database: LexiDatabase = db) {
  await database.transaction("rw", database.settings, database.meta, async () => {
    await database.settings.put(settings);
    await markChanged(database);
  });
  announceChange();
}
/** Темп курса: расписание и дневной предел карточек. Сохранение расписания сразу закрепляет прошедшие уроки курса. */
export async function saveCourseTempo(
  courseId: string,
  tempo: Partial<Pick<Course, "schedule" | "newItemsPerDay">>,
  now: Date,
  database: LexiDatabase = db,
): Promise<number> {
  await database.transaction("rw", database.courses, database.meta, async () => {
    const course = await database.courses.get(courseId);
    if (!course) throw new Error("Курс не найден");
    await database.courses.put({ ...course, ...tempo, updatedAt: stamp(new Date()) });
    await markChanged(database);
  });
  return settleLessons(now, database);
}

/** Старые неотвеченные recall заменяются один раз, история остаётся неизменной. */
export async function prepareObjectiveSession(id: string, database: LexiDatabase = db): Promise<void> {
  // Соседи по урокам читаются до транзакции: так её область не расширяется на связи уроков.
  const before = await database.sessions.get(id);
  if (!before || before.objectiveVersion === 1) return;
  const wordIds = before.items.flatMap((item) => (item.card.kind === "word" ? [item.card.word.id] : []));
  const [mates, sessionWords] = await Promise.all([lessonMates(wordIds, database), liveSessionWords(before, database)]);
  await database.transaction("rw", database.sessions, database.words, database.phrases, async () => {
    const session = await database.sessions.get(id);
    if (!session || session.objectiveVersion === 1) return;
    const pool = await optionPool(OPTION_POOL, database);
    const phrases = session.items.some((item) => item.card.kind === "phrase")
      ? await phrasePool(OPTION_POOL, database)
      : [];
    const poolsOf = (item: SessionItem) => ({
      words: item.card.kind === "word" ? closeSources(item.card.word.id, mates, sessionWords, pool) : NO_WORDS,
      phrases,
    });
    const items = session.items.map((item) =>
      item.type === "recall" && !item.eventId
        ? {
            ...item,
            ...(exerciseFor(item.card, poolsOf(item), emptySkills(), Math.random, false) ?? {
              type: "spelling" as const,
              options: [],
            }),
          }
        : item,
    );
    await database.sessions.put({
      ...session,
      items: spaceSingleIntroduction(items),
      objectiveVersion: 1,
      introducedKeys: session.introducedKeys ?? [],
    });
  });
}

/** Просмотр не является ответом и не меняет расписание. Знакомство сохраняется по ключу карточки. */
export async function markIntroduced(
  id: string,
  key: string,
  activeTimeMs: number,
  database: LexiDatabase = db,
): Promise<void> {
  await database.transaction("rw", database.sessions, async () => {
    const session = await database.sessions.get(id);
    if (!session || session.status !== "active") throw new Error("Занятие недоступно");
    if (!session.items.some((item) => item.unitKey === key && item.isNew && !item.eventId))
      throw new Error("Карточка недоступна");
    await database.sessions.put({
      ...session,
      introducedKeys: [...new Set([...(session.introducedKeys ?? []), key])],
      activeTimeMs,
    });
  });
}
