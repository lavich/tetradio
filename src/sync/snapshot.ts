import type { Card } from "ts-fsrs";
import { READING_PREFIX } from "../content/schema";
import type { AppDatabase } from "../storage/db";
import { byTime, emptySkills, emptyStats, foldSkill, foldStats, type SkillSummary } from "../domain/skills";
import { KINDS } from "../domain/kinds";
import { isForeign, storedKey, unitKey } from "../domain/refs";
import {
  CARD_KINDS,
  type Lesson,
  type LearningRef,
  type LearningState,
  type ReviewEvent,
  type StoredRef,
} from "../domain/types";
import { CONTENT_TABLES, STORED_KINDS } from "../storage/kinds";
import { blockKey } from "../storage/course";
import type { BlockProgress } from "../domain/types";
import {
  SNAPSHOT_FORMAT,
  type Clock,
  type CompactBlock,
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
const isKnown = (state: CompactState): state is CompactState & { ref: LearningRef } => !isForeign(state.ref);
/** Состояние карточки известного вида; незнакомые остаются в `cardStash`. */
const reviveState = (state: CompactState & { ref: LearningRef }): LearningState => ({
  unitKey: unitKey(state.ref),
  ref: state.ref,
  card: reviveCard(state.card),
  introducedAt: state.introducedAt,
  version: state.version,
});

export const readMeta = async (database: AppDatabase, key: string) => (await database.meta.get(key))?.value ?? null;
export const writeMeta = (database: AppDatabase, key: string, value: string | null) =>
  value === null ? database.meta.delete(key) : database.meta.put({ key, value });
export const parseClock = (raw: string | null): Clock => {
  try {
    const clock = raw ? JSON.parse(raw) : {};
    return clock && typeof clock === "object" ? clock : {};
  } catch {
    return {};
  }
};

/** Ключи перечисленных карточек, которые есть на устройстве; ключи снятых и незнакомых видов сюда не попадают. */
async function presentKeys(database: AppDatabase, refs: StoredRef[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const kind of CARD_KINDS) {
    const ids = refs.flatMap((ref) => (!isForeign(ref) && ref.kind === kind ? [ref.id] : []));
    if (ids.length)
      for (const id of await STORED_KINDS[kind].presentIds(ids, database)) keys.add(unitKey({ kind, id }));
  }
  return keys;
}
const compactLesson = (lesson: Lesson): CompactLesson => ({
  id: lesson.id,
  completed: lesson.completed,
  updatedAt: lesson.updatedAt,
});
const lessonPatch = (lesson: CompactLesson) => ({ completed: lesson.completed, updatedAt: lesson.updatedAt });
const compactBlock = (row: BlockProgress): CompactBlock => ({
  lessonId: row.lessonId,
  blockId: row.blockId,
  done: row.done,
  ...(row.score ? { score: { correct: row.score.correct, almost: row.score.almost, total: row.score.total } } : {}),
  ...(row.checks?.length ? { checks: [...row.checks] } : {}),
  updatedAt: row.updatedAt,
});
const byBlock = (a: CompactBlock, b: CompactBlock) =>
  a.lessonId.localeCompare(b.lessonId) || a.blockId.localeCompare(b.blockId);
/**
 * Блоки версии заменяют локальные целиком. Ответы и текст остаются, только если версия не новее локальной записи:
 * у более новой попытки с другого устройства старые ответы не соответствовали бы её счёту.
 */
async function applyBlocks(database: AppDatabase, blocks: CompactBlock[]) {
  const local = new Map((await database.blockProgress.toArray()).map((row) => [row.key, row]));
  const rows = blocks.map((block): BlockProgress => {
    const key = blockKey(block.lessonId, block.blockId);
    const previous = local.get(key);
    const keep = !!previous && block.updatedAt <= previous.updatedAt;
    return {
      key,
      lessonId: block.lessonId,
      blockId: block.blockId,
      done: block.done,
      ...(block.score ? { score: block.score } : {}),
      ...(block.checks ? { checks: block.checks } : {}),
      ...(keep && previous.answers ? { answers: previous.answers } : {}),
      ...(keep && previous.text !== undefined ? { text: previous.text } : {}),
      updatedAt: block.updatedAt,
    };
  });
  const incoming = new Set(rows.map((row) => row.key));
  await database.blockProgress.bulkDelete([...local.keys()].filter((key) => !incoming.has(key)));
  await database.blockProgress.bulkPut(rows);
}
const uniqueRefs = (refs: LearningRef[]) => [...new Map(refs.map((ref) => [unitKey(ref), ref])).values()];
const byKey = (a: { ref: StoredRef }, b: { ref: StoredRef }) => storedKey(a.ref).localeCompare(storedKey(b.ref));

type Progress = Omit<CompactSnapshot, "skills" | "stats">;
type Summary = Pick<CompactSnapshot, "skills" | "stats">;
const PROGRESS_TABLES = ["lessons", "packages", "blockProgress", "cardStates", "cardStash", "meta"] as const;
// Наличие карточки в сводке проверяется по таблицам содержимого всех видов.
const SUMMARY_TABLES = ["cardSkills", "baseSummary", "events", ...CONTENT_TABLES];
/** Таблицы сборки снимка; транзакцию чтения по ним открывает вызывающий. */
export const SNAPSHOT_TABLES = [...new Set([...PROGRESS_TABLES, ...SUMMARY_TABLES])];
const tables = (database: AppDatabase, names: readonly string[]) => names.map((name) => database.table(name));

async function readProgress(database: AppDatabase, now: Date): Promise<Progress> {
  const packages = new Set((await database.packages.toCollection().primaryKeys()) as string[]);
  const lessons: CompactLesson[] = (await database.lessons.toArray())
    .filter((lesson) => packages.has(lesson.id))
    .map(compactLesson);
  // Уроки из чужого снимка, ещё не появившиеся здесь, остаются в версии: иначе публикация отсюда их бы потеряла.
  const present = new Set(lessons.map((lesson) => lesson.id));
  const pending = parsePending((await database.meta.get(META.pendingLessons))?.value ?? null);
  for (const lesson of Object.values(pending)) if (!present.has(lesson.id)) lessons.push(lesson);
  lessons.sort((a, b) => a.id.localeCompare(b.id));
  const blocks = (await database.blockProgress.toArray()).map(compactBlock).sort(byBlock);
  const rawStates = await database.cardStates.toArray();
  const known = new Set(rawStates.map((state) => state.unitKey));
  const states = rawStates.map(serializeState);
  for (const row of await database.cardStash.toArray()) if (!known.has(row.unitKey)) states.push(row.state);
  return {
    format: SNAPSHOT_FORMAT,
    createdAt: now.toISOString(),
    lessons,
    packages: [...packages].sort(),
    blocks,
    states: states.sort(byKey),
  };
}
/**
 * Сводки навыков и статистики: база предыдущего снимка плюс локальные события после её отсечки и до `until`
 * включительно. Событие позже `until` учтёт следующая сводка — иначе его посчитали бы эта и следующая.
 */
async function readSummary(database: AppDatabase, until: string): Promise<Summary> {
  const base = await database.baseSummary.get("base");
  const fresh: ReviewEvent[] = byTime(
    !base
      ? await database.events.where("createdAt").belowOrEqual(until).toArray()
      : base.asOf < until
        ? await database.events.where("createdAt").between(base.asOf, until, false, true).toArray()
        : [],
  );
  const skills = new Map<string, { ref: StoredRef; skills: SkillSummary }>(
    (await database.cardSkills.toArray()).map((row) => [row.unitKey, { ref: row.ref, skills: row.skills }]),
  );
  const eventKeys = await presentKeys(database, uniqueRefs(fresh.map((event) => event.ref)));
  for (const event of fresh)
    if (eventKeys.has(event.unitKey))
      skills.set(event.unitKey, {
        ref: event.ref,
        skills: foldSkill(skills.get(event.unitKey)?.skills ?? emptySkills(), event),
      });
  const stats = foldStats(base?.stats ?? emptyStats(), fresh, KEEP_DAYS);
  return { skills: [...skills.values()].sort(byKey), stats: { ...stats, days: stats.days.slice(-KEEP_DAYS) } };
}
/** Компактный снимок из локальной базы; вызывается внутри транзакции чтения по `SNAPSHOT_TABLES`. */
export async function buildSnapshot(database: AppDatabase, now: Date): Promise<CompactSnapshot> {
  const progress = await readProgress(database, now);
  return { ...progress, ...(await readSummary(database, progress.createdAt)) };
}
export const readSnapshot = (database: AppDatabase, now: Date) =>
  database.transaction("r", tables(database, SNAPSHOT_TABLES), () => buildSnapshot(database, now));
/** Новая база: отсечка — момент сборки, локальные события до неё считаются учтёнными в снимке. */
export async function commitBase(database: AppDatabase, snapshot: Summary, versionId: string, asOf: string) {
  await database.cardSkills.clear();
  await database.cardSkills.bulkPut(
    snapshot.skills.map((entry) => ({ unitKey: storedKey(entry.ref), ref: entry.ref, skills: entry.skills })),
  );
  await database.baseSummary.put({ id: "base", asOf, versionId, stats: snapshot.stats });
}
export async function buildAndCommit(database: AppDatabase, now: Date, versionId: string): Promise<CompactSnapshot> {
  return (await buildAndCommitMarked(database, now, versionId)).snapshot;
}
/**
 * Прогресс читается без блокировки записи, затем сводки собираются и фиксируются одной транзакцией по своим таблицам:
 * отсечка совпадает с прочитанными событиями. Отметка изменений читается первой — изменение между двумя транзакциями
 * оставит её другой, и `clearDirty` после публикации не снимет флаг.
 */
export async function buildAndCommitMarked(
  database: AppDatabase,
  now: Date,
  versionId: string,
): Promise<{ snapshot: CompactSnapshot; mark: string | null }> {
  const { mark, progress } = await database.transaction("r", tables(database, PROGRESS_TABLES), async () => ({
    mark: await readMeta(database, META.dirty),
    progress: await readProgress(database, now),
  }));
  const summary = await database.transaction("rw", tables(database, SUMMARY_TABLES), async () => {
    const summary = await readSummary(database, progress.createdAt);
    // Часы устройства могли уйти назад: отсечка не отступает, иначе учтённые события посчитались бы снова.
    const base = await database.baseSummary.get("base");
    const asOf = base && base.asOf > progress.createdAt ? base.asOf : progress.createdAt;
    await commitBase(database, summary, versionId, asOf);
    return summary;
  });
  return { snapshot: { ...progress, ...summary }, mark };
}
export async function clearDirty(database: AppDatabase, mark: string | null): Promise<boolean> {
  const current = await readMeta(database, META.dirty);
  if (current !== null && current !== mark) return false;
  await writeMeta(database, META.dirty, null);
  return true;
}

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
export const readPending = async (database: AppDatabase): Promise<PendingLessons> =>
  parsePending(await readMeta(database, META.pendingLessons));

/**
 * Применение целой версии одной транзакцией: настройки, предел курса, завершение уроков, блоки курса,
 * состояния FSRS карточек, база навыков и сводок. История ответов остаётся локальной. Состояния неизвестных карточек откладываются
 * до установки пакета, а не обнуляются и не попадают в план.
 * `ifClean` — применять, только если локальных неопубликованных изменений нет; иначе `false` без записи.
 */
export async function applySnapshot(
  database: AppDatabase,
  snapshot: CompactSnapshot,
  versionId: string,
  clock: Clock,
  now: Date,
  { ifClean = false }: { ifClean?: boolean } = {},
): Promise<boolean> {
  return database.transaction(
    "rw",
    tables(
      database,
      SNAPSHOT_TABLES.filter((name) => name !== "events"),
    ),
    async () => {
      if (ifClean && (await readMeta(database, META.dirty))) return false;
      const pending: PendingLessons = {};
      for (const lesson of snapshot.lessons) {
        if (await database.lessons.get(lesson.id)) await database.lessons.update(lesson.id, lessonPatch(lesson));
        else pending[lesson.id] = lesson;
      }
      await writeMeta(database, META.pendingLessons, Object.keys(pending).length ? JSON.stringify(pending) : null);
      // Как и блоки: завершение урока, которого в версии нет, снимается.
      const listed = new Set(snapshot.lessons.map((lesson) => lesson.id));
      for (const lesson of await database.lessons.toArray())
        if (lesson.completed && !listed.has(lesson.id))
          await database.lessons.update(lesson.id, { completed: false, updatedAt: now.toISOString() });
      await applyBlocks(database, snapshot.blocks);
      const incoming = new Set(snapshot.states.map((state) => storedKey(state.ref)));
      // Карточки, которых нет в выбранной версии, снова становятся новыми.
      const local = (await database.cardStates.toCollection().primaryKeys()) as string[];
      await database.cardStates.bulkDelete(local.filter((key) => !incoming.has(key)));
      const known = await presentKeys(
        database,
        snapshot.states.map((state) => state.ref),
      );
      await database.cardStash.clear();
      for (const state of snapshot.states) {
        const key = storedKey(state.ref);
        if (known.has(key) && isKnown(state)) await database.cardStates.put(reviveState(state));
        else await database.cardStash.put({ unitKey: key, ref: state.ref, state });
      }
      await commitBase(database, snapshot, versionId, now.toISOString());
      await writeMeta(database, META.applied, versionId);
      await writeMeta(database, META.clock, JSON.stringify(clock));
      await writeMeta(database, META.dirty, null);
      return true;
    },
  );
}

/**
 * Пакет установлен: отложенные состояния его карточек переходят в обычную таблицу, завершение урока — из снимка.
 * Вызывается внутри транзакции установки пакета.
 */
export async function adoptStash(database: AppDatabase, lessonId: string, refs: LearningRef[]): Promise<void> {
  for (const ref of refs) {
    // Пакет мог встать раньше переноса узнанного вида: тогда состояние ещё лежит под ключом незнакомого.
    const keys = [unitKey(ref), storedKey({ code: KINDS[ref.kind].code, id: ref.id })];
    const row = (await database.cardStash.bulkGet(keys)).find((found) => !!found);
    if (!row) continue;
    const key = unitKey(ref);
    if (!(await database.cardStates.get(key))) await database.cardStates.put(reviveState({ ...row.state, ref }));
    await database.cardStash.delete(row.unitKey);
  }
  const pending = await readPending(database);
  const lesson = pending[lessonId];
  if (lesson) {
    await database.lessons.update(lessonId, lessonPatch(lesson));
    delete pending[lessonId];
    await writeMeta(database, META.pendingLessons, Object.keys(pending).length ? JSON.stringify(pending) : null);
  }
}

export interface SnapshotDescription {
  cards: number;
  answers: number;
  lastDay: string | null;
  lessons: number;
  courseLessons: number;
  blocks: number;
}
export const describeSnapshot = (snapshot: CompactSnapshot): SnapshotDescription => ({
  // В выборе версии «карточки» — слова и фразы; ошибки уроков рождаются из заданий и сюда не входят.
  cards: snapshot.states.filter((state) => isForeign(state.ref) || state.ref.kind !== "mistake").length,
  answers: snapshot.stats.answers,
  lessons: snapshot.lessons.length,
  courseLessons: (() => {
    const course = new Set(snapshot.blocks.map((block) => block.lessonId));
    return snapshot.lessons.filter((lesson) => lesson.completed && course.has(lesson.id)).length;
  })(),
  // Отметки «прочитано» — не выполненные задания.
  blocks: snapshot.blocks.filter((block) => block.done && !block.lessonId.startsWith(READING_PREFIX)).length,
  lastDay: snapshot.stats.days.length ? snapshot.stats.days[snapshot.stats.days.length - 1].date : null,
});
/** Есть ли локальный прогресс, который нельзя молча заменить облаком при первом подключении. */
export const hasLocalProgress = async (database: AppDatabase) =>
  (await database.cardStates.count()) > 0 ||
  (await database.events.count()) > 0 ||
  (await database.blockProgress.count()) > 0;
