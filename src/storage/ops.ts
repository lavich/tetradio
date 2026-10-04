import { db, type AppDatabase } from "./db";
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
import { snapshotOf } from "../domain/refs";
import { emptySkills } from "../domain/skills";
import {
  type Lesson,
  type ReviewEvent,
  type Session,
  type SessionItem,
  type Settings,
  type Word,
} from "../domain/types";
import { syncEvents } from "../sync/events";

/**
 * Отметка «есть неопубликованные изменения» пишется в той же транзакции, что и само изменение.
 * Каждое изменение пишет новую метку: публикация снимает только ту, что прочитала при сборке снимка.
 */
export const DIRTY_KEY = "sync:dirty";
let changes = 0;
export const dirtyMark = () =>
  `${Date.now().toString(36)}-${(++changes).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
export const markChanged = (database: AppDatabase) => database.meta.put({ key: DIRTY_KEY, value: dirtyMark() });
export const announceChange = () => syncEvents.emit("changed");
const settled = (items: SessionItem[]) => items.filter((entry) => entry.eventId || entry.skipped).length;

export class ConflictError extends Error {
  constructor() {
    super("Карточка уже отвечена в другой вкладке. Обновите страницу.");
  }
}
const stamp = (now: Date) => now.toISOString();

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
  database?: AppDatabase;
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
      const updated = item.mode === "scheduled" ? nextState(state, item.ref, rating, now) : undefined;
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
  database: AppDatabase,
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
async function liveSessionWords(session: Session, database: AppDatabase): Promise<Word[]> {
  const ids = [...new Set(session.items.flatMap((item) => (item.card.kind === "word" ? [item.card.word.id] : [])))];
  return (await database.words.bulkGet(ids)).flatMap((word) => (word && !word.deletedAt ? [word] : []));
}
/** Источники вариантов слова в занятии: соседи по урокам, живые слова занятия и пул словаря. */
async function wordSourcesOf(wordId: string, session: Session, database: AppDatabase) {
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
  database: AppDatabase = db,
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
export const endSession = async (session: Session, database: AppDatabase = db) => {
  await database.sessions.put({ ...session, status: session.index >= session.items.length ? "done" : "ended" });
};

export type LessonPatch = Partial<Pick<Lesson, "targetDate" | "status">>;
export async function updateLesson(id: string, patch: LessonPatch, database: AppDatabase = db) {
  await database.transaction("rw", database.lessons, database.meta, async () => {
    await database.lessons.update(id, { ...patch, updatedAt: stamp(new Date()) });
    await markChanged(database);
  });
  announceChange();
}
export async function saveSettings(settings: Settings, database: AppDatabase = db) {
  await database.transaction("rw", database.settings, database.meta, async () => {
    await database.settings.put(settings);
    await markChanged(database);
  });
  announceChange();
}
export async function saveNewItemsPerDay(courseId: string, newItemsPerDay: number, database: AppDatabase = db) {
  await database.transaction("rw", database.courses, database.meta, async () => {
    const course = await database.courses.get(courseId);
    if (!course) throw new Error("Курс не найден");
    await database.courses.put({ ...course, newItemsPerDay, updatedAt: stamp(new Date()) });
    await markChanged(database);
  });
  announceChange();
}

/** Старые неотвеченные recall заменяются один раз, история остаётся неизменной. */
export async function prepareObjectiveSession(id: string, database: AppDatabase = db): Promise<void> {
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
  database: AppDatabase = db,
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
