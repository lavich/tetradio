import type { Card } from "ts-fsrs";
import { isStandardWord, SEED_LESSON, type LexiDatabase } from "../storage/db";
import { byTime, emptySkills, emptyStats, foldSkill, foldStats, type SkillSummary } from "../domain/skills";
import { unitKey } from "../domain/refs";
import {
  fillSchedule,
  fillSettings,
  type CardKind,
  type LearningRef,
  type LearningState,
  type ReviewEvent,
} from "../domain/types";
import { loadSettings } from "../storage/queries";
import { SyncError } from "./transport";
import {
  LEGACY_SNAPSHOT_FORMAT,
  SNAPSHOT_FORMAT,
  type Clock,
  type CompactLesson,
  type CompactSnapshot,
  type CompactState,
  type SerializedCard,
} from "./types";

/** Ключи служебных записей синхронизации в `meta`; префикс исключает их из копии. */
export const META = {
  device: "sync:device",
  clock: "sync:clock",
  applied: "sync:applied",
  dirty: "sync:dirty",
  lastOk: "sync:lastOk",
  restored: "sync:restored",
  pendingLessons: "sync:pendingLessons",
  welcomed: "sync:welcomed",
} as const;
export const KEEP_DAYS = 14;

export const serializeCard = (card: Card): SerializedCard => ({
  ...card,
  due: new Date(card.due).toISOString(),
  last_review: card.last_review ? new Date(card.last_review).toISOString() : undefined,
});
export const reviveCard = (card: SerializedCard): Card => ({
  ...card,
  due: new Date(card.due),
  last_review: card.last_review ? new Date(card.last_review) : undefined,
});
const serializeState = (state: LearningState): CompactState => ({
  ref: state.ref,
  card: serializeCard(state.card),
  introducedAt: state.introducedAt,
  version: state.version,
});
const reviveState = (state: CompactState): LearningState => ({
  unitKey: unitKey(state.ref),
  ref: state.ref,
  card: reviveCard(state.card),
  introducedAt: state.introducedAt,
  version: state.version,
});

export const readMeta = async (database: LexiDatabase, key: string) => (await database.meta.get(key))?.value ?? null;
export const writeMeta = (database: LexiDatabase, key: string, value: string | null) =>
  value === null ? database.meta.delete(key) : database.meta.put({ key, value });
export const parseClock = (raw: string | null): Clock => {
  try {
    const clock = raw ? JSON.parse(raw) : {};
    return clock && typeof clock === "object" ? clock : {};
  } catch {
    return {};
  }
};

const isStandardLesson = (id: string, packages: Set<string>) => packages.has(id) || SEED_LESSON.test(id);
/**
 * Ключи поставляемых карточек среди перечисленных: слово — по ревизии или исходному набору,
 * фраза — по наличию записи с ревизией. Пользовательские слова в облако не уходят.
 */
async function standardKeys(database: LexiDatabase, refs: LearningRef[]): Promise<Set<string>> {
  const ids: Record<CardKind, string[]> = { word: [], phrase: [] };
  for (const ref of refs) ids[ref.kind]?.push(ref.id);
  const keys = new Set<string>();
  if (ids.word.length)
    for (const word of await database.words.bulkGet(ids.word))
      if (word && isStandardWord(word)) keys.add(unitKey({ kind: "word", id: word.id }));
  if (ids.phrase.length)
    for (const phrase of await database.phrases.bulkGet(ids.phrase))
      if (phrase?.revision !== undefined) keys.add(unitKey({ kind: "phrase", id: phrase.id }));
  return keys;
}
const uniqueRefs = (refs: LearningRef[]) => [...new Map(refs.map((ref) => [unitKey(ref), ref])).values()];
const byKey = (a: { ref: LearningRef }, b: { ref: LearningRef }) => unitKey(a.ref).localeCompare(unitKey(b.ref));

/**
 * Компактный снимок из локальной базы: база предыдущего снимка плюс локальные события после её отсечки.
 * Вызывается внутри транзакции чтения-записи вместе с `commitBase`, чтобы отсечка совпала с прочитанным.
 */
export async function buildSnapshot(database: LexiDatabase, now: Date): Promise<CompactSnapshot> {
  const base = await database.baseSummary.get("base");
  const settings = await loadSettings(database);
  const packages = new Set((await database.packages.toArray()).map((pack) => pack.lessonId));
  const lessons: CompactLesson[] = (await database.lessons.toArray())
    .filter((lesson) => isStandardLesson(lesson.id, packages))
    .map((lesson) => ({
      id: lesson.id,
      targetDate: lesson.targetDate,
      status: lesson.status,
      updatedAt: lesson.updatedAt,
    }));
  const rawStates = await database.cardStates.toArray();
  const known = await standardKeys(
    database,
    rawStates.map((state) => state.ref),
  );
  const states = rawStates.filter((state) => known.has(state.unitKey)).map(serializeState);
  for (const row of await database.cardStash.toArray()) if (!known.has(row.unitKey)) states.push(row.state);
  const fresh: ReviewEvent[] = byTime(
    base ? await database.events.where("createdAt").above(base.asOf).toArray() : await database.events.toArray(),
  );
  const skills = new Map<string, { ref: LearningRef; skills: SkillSummary }>(
    (await database.cardSkills.toArray()).map((row) => [row.unitKey, { ref: row.ref, skills: row.skills }]),
  );
  const eventKeys = await standardKeys(database, uniqueRefs(fresh.map((event) => event.ref)));
  for (const event of fresh)
    if (eventKeys.has(event.unitKey))
      skills.set(event.unitKey, {
        ref: event.ref,
        skills: foldSkill(skills.get(event.unitKey)?.skills ?? emptySkills(), event),
      });
  const stats = fresh.reduce((summary, event) => foldStats(summary, event, KEEP_DAYS), base?.stats ?? emptyStats());
  return {
    format: SNAPSHOT_FORMAT,
    createdAt: now.toISOString(),
    settings: { timezone: settings.timezone, sessionSize: settings.sessionSize },
    courses: (await database.courses.toArray())
      .map((course) => ({
        id: course.id,
        subscribed: course.subscribed,
        newItemsPerDay: course.newItemsPerDay,
        schedule: course.schedule,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    lessons,
    packages: [...packages].sort(),
    states: states.sort(byKey),
    skills: [...skills.values()].sort(byKey),
    stats: { ...stats, days: stats.days.slice(-KEEP_DAYS) },
  };
}
/** Новая база: отсечка — момент сборки, локальные события до неё считаются учтёнными в снимке. */
export async function commitBase(database: LexiDatabase, snapshot: CompactSnapshot, versionId: string, asOf: string) {
  await database.cardSkills.clear();
  await database.cardSkills.bulkPut(
    snapshot.skills.map((entry) => ({ unitKey: unitKey(entry.ref), ref: entry.ref, skills: entry.skills })),
  );
  await database.baseSummary.put({ id: "base", asOf, versionId, stats: snapshot.stats });
}
export const SNAPSHOT_TABLES = [
  "cardSkills",
  "baseSummary",
  "cardStates",
  "words",
  "phrases",
  "events",
  "settings",
  "courses",
  "lessons",
  "packages",
  "cardStash",
  "meta",
] as const;
/** Сборка и фиксация базы одной транзакцией: ответ, записанный после, гарантированно попадёт в следующую версию. */
export async function buildAndCommit(database: LexiDatabase, now: Date, versionId: string): Promise<CompactSnapshot> {
  return database.transaction(
    "rw",
    SNAPSHOT_TABLES.map((name) => database.table(name)),
    async () => {
      const snapshot = await buildSnapshot(database, now);
      await commitBase(database, snapshot, versionId, snapshot.createdAt);
      return snapshot;
    },
  );
}

export type PendingLessons = Record<string, CompactLesson>;
export const readPending = async (database: LexiDatabase): Promise<PendingLessons> => {
  try {
    return JSON.parse((await readMeta(database, META.pendingLessons)) ?? "{}");
  } catch {
    return {};
  }
};

/** Есть ли сохранённый прогресс фраз: состояния, события или сводки. Само наличие их контента не считается. */
export async function hasMixedProgress(database: LexiDatabase): Promise<boolean> {
  const mixed = (ref: LearningRef) => ref.kind !== "word";
  if (await database.cardStates.where("ref.kind").equals("phrase").count()) return true;
  if ((await database.cardStash.toArray()).some((row) => mixed(row.ref))) return true;
  if ((await database.cardSkills.toArray()).some((row) => mixed(row.ref))) return true;
  const base = await database.baseSummary.get("base");
  if (
    base?.stats.answeredKeys.some((key) => !key.startsWith('["word"')) ||
    base?.stats.days.some((day) => day.keys.some((key) => !key.startsWith('["word"')))
  )
    return true;
  return !!(await database.events.filter((event) => mixed(event.ref)).first());
}

/**
 * Применение целой версии одной транзакцией: настройки, даты стандартных уроков, состояния FSRS стандартных карточек,
 * база навыков и сводок. История ответов остаётся локальной. Состояния неизвестных карточек откладываются
 * до установки пакета, а не обнуляются и не попадают в план. Словарный снимок формата 1 не может представлять
 * фразы и пропуски: при уже сохранённом прогрессе новых видов он отклоняется до изменения данных.
 */
export async function applySnapshot(
  database: LexiDatabase,
  snapshot: CompactSnapshot,
  versionId: string,
  clock: Clock,
  now: Date,
  sourceFormat: number = SNAPSHOT_FORMAT,
): Promise<void> {
  await database.transaction(
    "rw",
    SNAPSHOT_TABLES.map((name) => database.table(name)),
    async () => {
      if (sourceFormat === LEGACY_SNAPSHOT_FORMAT && (await hasMixedProgress(database)))
        throw new SyncError(
          "format",
          "Облачная версия словарного формата 1 не может заменить прогресс фраз и пропусков на этом устройстве. Обновите приложение на другом устройстве; локальные данные не изменены.",
        );
      const current = await loadSettings(database);
      await database.settings.put(fillSettings({ ...current, ...snapshot.settings }));
      // Темп курса переносится, а курс, которого здесь ещё нет, будет заведён каталогом с этими же значениями.
      for (const incoming of snapshot.courses) {
        const stored = await database.courses.get(incoming.id);
        if (stored)
          await database.courses.put({
            ...stored,
            subscribed: incoming.subscribed,
            newItemsPerDay: incoming.newItemsPerDay,
            // Снимок прежнего клиента приходит без часа занятия: в базу он ложится уже с полуднем.
            schedule: fillSchedule(incoming.schedule),
          });
      }
      const pending: PendingLessons = {};
      for (const lesson of snapshot.lessons) {
        if (await database.lessons.get(lesson.id))
          await database.lessons.update(lesson.id, {
            targetDate: lesson.targetDate,
            status: lesson.status,
            updatedAt: lesson.updatedAt,
          });
        else pending[lesson.id] = lesson;
      }
      await writeMeta(database, META.pendingLessons, Object.keys(pending).length ? JSON.stringify(pending) : null);
      const incoming = new Set(snapshot.states.map((state) => unitKey(state.ref)));
      const local = await database.cardStates.toArray();
      const localStandard = await standardKeys(
        database,
        local.map((state) => state.ref),
      );
      // Стандартные карточки, которых нет в выбранной версии, снова становятся новыми; пользовательские не трогаем.
      await database.cardStates.bulkDelete(
        local
          .filter((state) => localStandard.has(state.unitKey) && !incoming.has(state.unitKey))
          .map((state) => state.unitKey),
      );
      const known = await standardKeys(
        database,
        snapshot.states.map((state) => state.ref),
      );
      await database.cardStash.clear();
      for (const state of snapshot.states) {
        const key = unitKey(state.ref);
        if (known.has(key)) await database.cardStates.put(reviveState(state));
        else await database.cardStash.put({ unitKey: key, ref: state.ref, state });
      }
      await commitBase(database, snapshot, versionId, now.toISOString());
      await writeMeta(database, META.applied, versionId);
      await writeMeta(database, META.clock, JSON.stringify(clock));
      await writeMeta(database, META.dirty, null);
    },
  );
}

/**
 * Пакет установлен: отложенные состояния его карточек переходят в обычную таблицу, дата урока — из снимка.
 * Вызывается внутри транзакции установки пакета.
 */
export async function adoptStash(database: LexiDatabase, lessonId: string, refs: LearningRef[]): Promise<void> {
  const rows = (await database.cardStash.bulkGet(refs.map(unitKey))).filter(
    (row): row is NonNullable<typeof row> => !!row,
  );
  for (const row of rows) {
    if (!(await database.cardStates.get(row.unitKey))) await database.cardStates.put(reviveState(row.state));
    await database.cardStash.delete(row.unitKey);
  }
  const pending = await readPending(database);
  const lesson = pending[lessonId];
  if (lesson) {
    await database.lessons.update(lessonId, {
      targetDate: lesson.targetDate,
      status: lesson.status,
      updatedAt: lesson.updatedAt,
    });
    delete pending[lessonId];
    await writeMeta(database, META.pendingLessons, Object.keys(pending).length ? JSON.stringify(pending) : null);
  }
}

export interface SnapshotDescription {
  cards: number;
  answers: number;
  lastDay: string | null;
  lessons: number;
}
export const describeSnapshot = (snapshot: CompactSnapshot): SnapshotDescription => ({
  cards: snapshot.states.length,
  answers: snapshot.stats.answers,
  lessons: snapshot.lessons.length,
  lastDay: snapshot.stats.days.length ? snapshot.stats.days[snapshot.stats.days.length - 1].date : null,
});
/** Есть ли локальный прогресс, который нельзя молча заменить облаком при первом подключении. */
export const hasLocalProgress = async (database: LexiDatabase) =>
  (await database.cardStates.count()) > 0 || (await database.events.count()) > 0;
