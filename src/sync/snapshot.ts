import type { Card } from "ts-fsrs";
import { isStandardWord, SEED_LESSON, type AppDatabase } from "../storage/db";
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
import { blockKey } from "../storage/course";
import type { BlockProgress } from "../domain/types";
import { SyncError } from "./transport";
import {
  BLOCKS_SNAPSHOT_FORMAT,
  LEGACY_SNAPSHOT_FORMAT,
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

const isStandardLesson = (id: string, packages: Set<string>) => packages.has(id) || SEED_LESSON.test(id);
/**
 * Ключи поставляемых карточек среди перечисленных: слово — по ревизии или исходному набору,
 * фраза — по наличию записи с ревизией. Пользовательские слова в облако не уходят.
 */
async function standardKeys(database: AppDatabase, refs: LearningRef[]): Promise<Set<string>> {
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
/** Блок без введённых ответов и текста: они остаются на устройстве. */
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
 * Блоки выбранной версии заменяют локальные целиком: блока, которого в версии нет, здесь тоже не будет.
 * Введённые ответы и текст в снимок не входят, поэтому у оставшегося блока они сохраняются, только если версия
 * не новее локальной записи (`remote.updatedAt <= local.updatedAt`) — это та же или более ранняя попытка, и ответы
 * относятся к ней или к более поздней локальной. Более новая попытка с другого устройства приходит без ответов:
 * старые ответы не соответствовали бы её счёту. Блоки ещё не установленных уроков лежат в той же таблице и
 * появляются на экране после установки пакета.
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
const byKey = (a: { ref: LearningRef }, b: { ref: LearningRef }) => unitKey(a.ref).localeCompare(unitKey(b.ref));

/**
 * Компактный снимок из локальной базы: база предыдущего снимка плюс локальные события после её отсечки.
 * Вызывается внутри транзакции чтения-записи вместе с `commitBase`, чтобы отсечка совпала с прочитанным.
 */
export async function buildSnapshot(database: AppDatabase, now: Date): Promise<CompactSnapshot> {
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
  // Уроки из чужого снимка, ещё не появившиеся здесь, остаются в версии: иначе публикация отсюда их бы потеряла.
  const present = new Set(lessons.map((lesson) => lesson.id));
  const pending = parsePending((await database.meta.get(META.pendingLessons))?.value ?? null);
  for (const lesson of Object.values(pending)) if (!present.has(lesson.id)) lessons.push(lesson);
  lessons.sort((a, b) => a.id.localeCompare(b.id));
  const blocks = (await database.blockProgress.toArray()).map(compactBlock).sort(byBlock);
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
    blocks,
    states: states.sort(byKey),
    skills: [...skills.values()].sort(byKey),
    stats: { ...stats, days: stats.days.slice(-KEEP_DAYS) },
  };
}
/** Новая база: отсечка — момент сборки, локальные события до неё считаются учтёнными в снимке. */
export async function commitBase(database: AppDatabase, snapshot: CompactSnapshot, versionId: string, asOf: string) {
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
  "blockProgress",
  "meta",
] as const;
/** Сборка и фиксация базы одной транзакцией: ответ, записанный после, гарантированно попадёт в следующую версию. */
export async function buildAndCommit(database: AppDatabase, now: Date, versionId: string): Promise<CompactSnapshot> {
  return (await buildAndCommitMarked(database, now, versionId)).snapshot;
}
/**
 * То же плюс отметка изменений, прочитанная в той же транзакции: публикация снимает её, только если за время
 * выгрузки она не сменилась (`clearDirty`). Иначе изменение, сделанное во время выгрузки, осталось бы без отметки.
 */
export async function buildAndCommitMarked(
  database: AppDatabase,
  now: Date,
  versionId: string,
): Promise<{ snapshot: CompactSnapshot; mark: string | null }> {
  return database.transaction(
    "rw",
    SNAPSHOT_TABLES.map((name) => database.table(name)),
    async () => {
      const mark = await readMeta(database, META.dirty);
      const snapshot = await buildSnapshot(database, now);
      await commitBase(database, snapshot, versionId, snapshot.createdAt);
      return { snapshot, mark };
    },
  );
}
/** Снимает отметку изменений, если она та же, что при сборке опубликованного снимка; вызывается в транзакции `meta`. */
export async function clearDirty(database: AppDatabase, mark: string | null): Promise<boolean> {
  const current = await readMeta(database, META.dirty);
  if (current !== null && current !== mark) return false;
  await writeMeta(database, META.dirty, null);
  return true;
}

export type PendingLessons = Record<string, CompactLesson>;
const parsePending = (raw: string | null): PendingLessons => {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
export const readPending = async (database: AppDatabase): Promise<PendingLessons> =>
  parsePending(await readMeta(database, META.pendingLessons));

/** Есть ли сохранённый прогресс фраз: состояния, события или сводки. Само наличие их контента не считается. */
export async function hasMixedProgress(database: AppDatabase): Promise<boolean> {
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
 * Применение целой версии одной транзакцией: настройки, даты стандартных уроков, блоки курса (с формата 3),
 * состояния FSRS стандартных карточек,
 * база навыков и сводок. История ответов остаётся локальной. Состояния неизвестных карточек откладываются
 * до установки пакета, а не обнуляются и не попадают в план. Словарный снимок формата 1 не может представлять
 * фразы и пропуски: при уже сохранённом прогрессе новых видов он отклоняется до изменения данных.
 * `ifClean` — применять, только если локальных неопубликованных изменений нет; иначе `false` без записи.
 */
export async function applySnapshot(
  database: AppDatabase,
  snapshot: CompactSnapshot,
  versionId: string,
  clock: Clock,
  now: Date,
  sourceFormat: number = SNAPSHOT_FORMAT,
  { ifClean = false }: { ifClean?: boolean } = {},
): Promise<boolean> {
  return database.transaction(
    "rw",
    SNAPSHOT_TABLES.map((name) => database.table(name)),
    async () => {
      // Изменение успело появиться после решения «применить»: версия не применяется, решение принимается заново.
      if (ifClean && (await readMeta(database, META.dirty))) return false;
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
      if (sourceFormat >= BLOCKS_SNAPSHOT_FORMAT) await applyBlocks(database, snapshot.blocks);
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
      return true;
    },
  );
}

/**
 * Пакет установлен: отложенные состояния его карточек переходят в обычную таблицу, дата урока — из снимка.
 * Вызывается внутри транзакции установки пакета.
 */
export async function adoptStash(database: AppDatabase, lessonId: string, refs: LearningRef[]): Promise<void> {
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
  /** Завершённые уроки курса (с блоками) и выполненные блоки. */
  courseLessons: number;
  blocks: number;
}
export const describeSnapshot = (snapshot: CompactSnapshot): SnapshotDescription => ({
  cards: snapshot.states.length,
  answers: snapshot.stats.answers,
  lessons: snapshot.lessons.length,
  courseLessons: (() => {
    const course = new Set(snapshot.blocks.map((block) => block.lessonId));
    return snapshot.lessons.filter((lesson) => lesson.status === "completed" && course.has(lesson.id)).length;
  })(),
  blocks: snapshot.blocks.filter((block) => block.done).length,
  lastDay: snapshot.stats.days.length ? snapshot.stats.days[snapshot.stats.days.length - 1].date : null,
});
/** Есть ли локальный прогресс, который нельзя молча заменить облаком при первом подключении. */
export const hasLocalProgress = async (database: AppDatabase) =>
  (await database.cardStates.count()) > 0 ||
  (await database.events.count()) > 0 ||
  (await database.blockProgress.count()) > 0;
