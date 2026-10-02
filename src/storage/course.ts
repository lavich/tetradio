/**
 * Курс из модулей в базе: выполнение блоков, завершение урока и представления для экранов «Курс» и «Сегодня».
 * Прогресс блоков — данные пользователя (входят в копию); модули — кеш каталога.
 */
import type { CatalogModule, LessonBlock, LessonKind } from "../content/course";
import { cardRef, decodeMarks, type BlockMarks } from "../content/schema";
import { lessonDone, lessonTally, type LessonTally } from "../domain/course";
import { localDay } from "../domain/learning";
import type { BlockProgress, Lesson, StoredModule } from "../domain/types";
import { db, type AppDatabase } from "./db";
import { announceChange, markChanged } from "./ops";

export const blockKey = (lessonId: string, blockId: string) => `${lessonId}/${blockId}`;

export async function blockProgressOf(lessonId: string, database: AppDatabase = db) {
  const rows = await database.blockProgress.where("lessonId").equals(lessonId).toArray();
  return new Map(rows.map((row) => [row.blockId, row]));
}

export type BlockPatch = Partial<Omit<BlockProgress, "key" | "lessonId" | "blockId" | "updatedAt">>;
/** Сохраняет выполнение блока поверх прежнего: повторная проверка задания заменяет ответы и счёт. */
export async function saveBlockProgress(
  lessonId: string,
  blockId: string,
  patch: BlockPatch,
  database: AppDatabase = db,
): Promise<BlockProgress> {
  const saved = await database.transaction("rw", database.blockProgress, database.meta, async () => {
    const key = blockKey(lessonId, blockId);
    const previous = await database.blockProgress.get(key);
    const row: BlockProgress = {
      done: false,
      ...previous,
      ...patch,
      key,
      lessonId,
      blockId,
      updatedAt: new Date().toISOString(),
    };
    await database.blockProgress.put(row);
    await markChanged(database);
    return row;
  });
  announceChange();
  return saved;
}

export interface CourseLesson {
  id: string;
  title: string;
  kind: LessonKind;
  moduleId: string;
  position: number;
  blocks: LessonBlock[];
  lesson: Lesson | undefined;
  marks: BlockMarks;
  cards: Map<string, TapCard>;
}
/** `lesson` («1.2») — только у слова прошлого урока. */
export interface TapCard {
  ref: string;
  greek: string;
  russian: string;
  ipa?: string;
  forms?: string;
  lesson?: string;
  audioAssetId?: string;
}
/** Урок курса из установленного пакета; без пакета (не скачан, черновик) — `null`. */
export async function courseLesson(lessonId: string, database: AppDatabase = db): Promise<CourseLesson | null> {
  const [pack, lesson] = await Promise.all([database.packages.get(lessonId), database.lessons.get(lessonId)]);
  if (!pack?.module || !pack.blocks) return null;
  return {
    id: lessonId,
    title: lesson?.title ?? lessonId,
    kind: pack.kind ?? "lesson",
    moduleId: pack.module.id,
    position: pack.module.position,
    blocks: pack.blocks,
    lesson,
    marks: pack.marks ? decodeMarks(pack.marks, pack.items) : {},
    cards: new Map<string, TapCard>([
      ...pack.words.map((word): [string, TapCard] => [
        cardRef("word", word.id),
        {
          ref: cardRef("word", word.id),
          greek: word.greek,
          russian: word.russian,
          ipa: word.ipa,
          forms: word.forms,
          audioAssetId: word.audioAssetId,
        },
      ]),
      ...pack.phrases.map((phrase): [string, TapCard] => [
        cardRef("phrase", phrase.id),
        {
          ref: cardRef("phrase", phrase.id),
          greek: phrase.text,
          russian: phrase.translation ?? "",
          audioAssetId: phrase.audioAssetId,
        },
      ]),
      ...(pack.marks?.cards ?? []).map((card): [string, TapCard] => [card.ref, card]),
    ]),
  };
}

export class LessonIncompleteError extends Error {}
/** Урок завершается только выполненным: просмотр страницы не равен освоению. */
export async function completeLesson(lessonId: string, database: AppDatabase = db): Promise<void> {
  const view = await courseLesson(lessonId, database);
  if (!view) throw new LessonIncompleteError("Урок не установлен");
  const progress = await blockProgressOf(lessonId, database);
  if (!lessonDone(view.blocks, progress)) throw new LessonIncompleteError("В уроке остались невыполненные задания");
  const changed = await database.transaction("rw", database.lessons, database.meta, async () => {
    const lesson = await database.lessons.get(lessonId);
    if (!lesson || lesson.status === "completed") return false;
    await database.lessons.put({ ...lesson, status: "completed", updatedAt: new Date().toISOString() });
    await markChanged(database);
    return true;
  });
  if (changed) announceChange();
}

export interface ModuleLessonView {
  id: string;
  title: string;
  kind: LessonKind;
  installed: boolean;
  completed: boolean;
  tally: LessonTally;
}
export interface ModuleView {
  module: CatalogModule;
  lessons: ModuleLessonView[];
  /** Контрольная точка программы после модуля (K1, M1–M3), если есть. */
  checkpoint?: ModuleLessonView;
  review: ModuleLessonView[];
  /** Все уроки модуля завершены. */
  completed: boolean;
}
/** Модули курса по номеру программы с состоянием уроков; черновики — без уроков. */
export async function moduleViews(courseId?: string, database: AppDatabase = db): Promise<ModuleView[]> {
  const modules: StoredModule[] = courseId
    ? await database.modules.where("courseId").equals(courseId).toArray()
    : await database.modules.toArray();
  modules.sort((a, b) => a.number - b.number);
  const lessonIds = modules.flatMap((module) => [
    ...module.lessonIds,
    ...(module.checkpointId ? [module.checkpointId] : []),
    ...(module.reviewIds ?? []),
  ]);
  const [packs, lessons, entries, progress] = await Promise.all([
    database.packages.bulkGet(lessonIds),
    database.lessons.bulkGet(lessonIds),
    database.catalog.bulkGet(lessonIds),
    database.blockProgress.where("lessonId").anyOf(lessonIds).toArray(),
  ]);
  const byLesson = new Map<string, Map<string, BlockProgress>>();
  for (const row of progress) {
    const map = byLesson.get(row.lessonId) ?? new Map();
    map.set(row.blockId, row);
    byLesson.set(row.lessonId, map);
  }
  let at = 0;
  return modules.map(({ position: _position, ...module }) => {
    const view = (id: string): ModuleLessonView => {
      const index = at++;
      const pack = packs[index],
        lesson = lessons[index],
        entry = entries[index];
      return {
        id,
        title: lesson?.title ?? entry?.title ?? id,
        kind: pack?.kind ?? "lesson",
        installed: !!pack,
        completed: lesson?.status === "completed",
        tally: lessonTally(pack?.blocks ?? [], byLesson.get(id) ?? new Map()),
      };
    };
    const views = module.lessonIds.map(view);
    const checkpoint = module.checkpointId ? view(module.checkpointId) : undefined;
    const review = (module.reviewIds ?? []).map(view);
    return {
      module,
      lessons: views,
      ...(checkpoint ? { checkpoint } : {}),
      review,
      completed: views.length > 0 && views.every((item) => item.completed),
    };
  });
}

/** Следующий шаг курса: первый незавершённый урок опубликованного модуля в порядке программы. */
export async function nextCourseLesson(
  courseId?: string,
  database: AppDatabase = db,
): Promise<{ module: CatalogModule; lesson: ModuleLessonView } | null> {
  for (const view of await moduleViews(courseId, database)) {
    if (view.module.status !== "published") continue;
    const lesson = view.lessons.find((item) => !item.completed);
    if (lesson) return { module: view.module, lesson };
    // Уроки модуля пройдены — следующий шаг контрольная точка после него.
    if (view.checkpoint && !view.checkpoint.completed) return { module: view.module, lesson: view.checkpoint };
    const review = view.review.find((item) => !item.completed);
    if (review) return { module: view.module, lesson: review };
  }
  return null;
}

/** Дни с выполненными заданиями уроков с `from` включительно — занятия курса на этой неделе. */
export async function lessonDays(from: string, timezone: string, database: AppDatabase = db): Promise<string[]> {
  const rows = await database.blockProgress.filter((row) => row.done).toArray();
  const days = new Set(rows.map((row) => localDay(new Date(row.updatedAt), timezone)).filter((day) => day >= from));
  return [...days].sort();
}

/** Сколько карточек повторено в этот день по плану; тренировка не в счёт. */
export async function reviewedOn(day: string, database: AppDatabase = db): Promise<number> {
  const events = await database.events.where("localDate").equals(day).toArray();
  return new Set(events.filter((event) => event.mode !== "practice").map((event) => event.unitKey)).size;
}
