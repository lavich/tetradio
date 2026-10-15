/**
 * Курс из модулей в базе: выполнение блоков, завершение урока и представления для экранов «Курс» и «Сегодня».
 * Прогресс блоков — данные пользователя (входят в копию); модули — кеш каталога.
 */
import type { CatalogModule, LessonBlock, LessonKind } from "../content/course";
import { cardRef, decodeMarks, READING_PREFIX, type BlockMarks } from "../content/schema";
import { lessonDone, tallyOf, type LessonTally } from "../domain/course";
import { localDay, nextState } from "../domain/learning";
import { unitKey } from "../domain/refs";
import { Rating } from "ts-fsrs";
import type { BlockProgress, Lesson, StoredModule } from "../domain/types";
import { cardsInCourse, lessonCourses, primaryCourse } from "./courses";
import { db, type AppDatabase } from "./db";
import { STORED_KINDS } from "./kinds";
import { announceChange, markChanged } from "./ops";
import { lessonOutlines } from "./outlines";
import { zoned } from "./zone";

export const blockKey = (lessonId: string, blockId: string) => `${lessonId}/${blockId}`;

export const blockProgressOf = zoned(async function blockProgressOf(lessonId: string, database: AppDatabase = db) {
  const rows = await database.blockProgress.where("lessonId").equals(lessonId).toArray();
  return new Map(rows.map((row) => [row.blockId, row]));
});

export type BlockPatch = Partial<Omit<BlockProgress, "key" | "lessonId" | "blockId" | "updatedAt">> & {
  /** Неверные пункты задания: из них рождаются карточки ошибок; в запись блока не идут. */
  mistakes?: string[];
};
/**
 * Сохраняет выполнение блока поверх прежнего: повторная проверка задания заменяет ответы и счёт.
 * Неверный пункт без карточки получает состояние «снова» — так он приходит в ближайшее повторение.
 * События ответа нет: урок — не занятие, и «Сегодня» не должно счесть его повторением.
 */
export async function saveBlockProgress(
  lessonId: string,
  blockId: string,
  { mistakes = [], ...patch }: BlockPatch,
  database: AppDatabase = db,
  now = new Date(),
): Promise<BlockProgress> {
  const saved = await database.transaction(
    "rw",
    database.blockProgress,
    database.meta,
    database.cardStates,
    async () => {
      for (const itemId of mistakes) {
        const ref = { kind: "mistake" as const, id: `${lessonId}/${blockId}/${itemId}` };
        if (!(await database.cardStates.get(unitKey(ref))))
          await database.cardStates.put(nextState(undefined, ref, Rating.Again, now));
      }
      const key = blockKey(lessonId, blockId);
      const previous = await database.blockProgress.get(key);
      const row: BlockProgress = {
        done: false,
        ...previous,
        ...patch,
        key,
        lessonId,
        blockId,
        updatedAt: now.toISOString(),
      };
      await database.blockProgress.put(row);
      await markChanged(database);
      return row;
    },
  );
  announceChange();
  if (saved.done) await completeIfDone(lessonId, database);
  return saved;
}

/** Карточки ошибок урока по состояниям — одинаковы на всех устройствах; убранный обновлением пункт не считается. */
export const lessonMistakes = zoned(async function lessonMistakes(
  lessonId: string,
  database: AppDatabase = db,
): Promise<number> {
  const ids = (await database.cardStates.where("ref.kind").equals("mistake").toArray())
    .map((state) => state.ref.id)
    .filter((id) => id.startsWith(`${lessonId}/`));
  return (await STORED_KINDS.mistake.presentIds(ids, database)).length;
});

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
export const courseLesson = zoned(async function courseLesson(
  lessonId: string,
  database: AppDatabase = db,
): Promise<CourseLesson | null> {
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
});

export class LessonIncompleteError extends Error {}
/** Урок завершается только выполненным: просмотр страницы не равен освоению. */
export async function completeLesson(lessonId: string, database: AppDatabase = db): Promise<void> {
  const view = await courseLesson(lessonId, database);
  if (!view) throw new LessonIncompleteError("Урок не установлен");
  const progress = await blockProgressOf(lessonId, database);
  if (!lessonDone(view.blocks, progress)) throw new LessonIncompleteError("В уроке остались невыполненные задания");
  const changed = await database.transaction("rw", database.lessons, database.meta, async () => {
    const lesson = await database.lessons.get(lessonId);
    if (!lesson || lesson.completed) return false;
    await database.lessons.put({ ...lesson, completed: true, updatedAt: new Date().toISOString() });
    await markChanged(database);
    return true;
  });
  if (changed) announceChange("finished");
}

/** Урок отмечается пройденным сам, как только выполнено последнее задание. */
export async function completeIfDone(lessonId: string, database: AppDatabase = db): Promise<boolean> {
  try {
    await completeLesson(lessonId, database);
    return true;
  } catch (error) {
    if (error instanceof LessonIncompleteError) return false;
    throw error;
  }
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
/** Модули курса по номеру программы с состоянием уроков; черновики — без уроков. Без курса — основной курс. */
export const moduleViews = zoned(async function moduleViews(
  courseId?: string,
  database: AppDatabase = db,
): Promise<ModuleView[]> {
  courseId ??= await primaryCourse(database);
  const modules: StoredModule[] = courseId
    ? await database.modules.where("courseId").equals(courseId).toArray()
    : await database.modules.toArray();
  modules.sort((a, b) => a.number - b.number);
  const lessonIds = modules.flatMap((module) => [
    ...module.lessonIds,
    ...(module.checkpointId ? [module.checkpointId] : []),
    ...(module.reviewIds ?? []),
  ]);
  const [outlines, lessons, entries, progress] = await Promise.all([
    lessonOutlines(lessonIds, database),
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
      const outline = outlines[index],
        lesson = lessons[index],
        entry = entries[index];
      return {
        id,
        title: lesson?.title ?? entry?.title ?? id,
        kind: outline?.kind ?? "lesson",
        installed: !!outline,
        completed: !!lesson?.completed,
        tally: tallyOf(outline?.tasks ?? [], byLesson.get(id) ?? new Map()),
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
});

/** Следующий шаг курса: первый незавершённый урок опубликованного модуля в порядке программы. */
export const nextCourseLesson = zoned(async function nextCourseLesson(
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
});

/** Дни с выполненными заданиями уроков с `from` включительно — занятия курса на этой неделе; без курса — всех. */
export const lessonDays = zoned(async function lessonDays(
  from: string,
  timezone: string,
  courseId?: string,
  database: AppDatabase = db,
): Promise<string[]> {
  // Чтение днём занятий не считается: отметка «прочитано» — строка блока текста.
  let rows = await database.blockProgress
    .filter((row) => row.done && !row.lessonId.startsWith(READING_PREFIX))
    .toArray();
  if (courseId) {
    const owners = await lessonCourses(
      rows.map((row) => row.lessonId),
      database,
    );
    rows = rows.filter((row) => owners.get(row.lessonId) === courseId);
  }
  const days = new Set(rows.map((row) => localDay(new Date(row.updatedAt), timezone)).filter((day) => day >= from));
  return [...days].sort();
});

/** Сколько карточек повторено в этот день по плану; тренировка не в счёт. С курсом — только карточки курса. */
export const reviewedOn = zoned(async function reviewedOn(
  day: string,
  courseId?: string,
  database: AppDatabase = db,
): Promise<number> {
  const events = await database.events.where("localDate").equals(day).toArray();
  const keys = [...new Set(events.filter((event) => event.mode !== "practice").map((event) => event.unitKey))];
  return courseId ? (await cardsInCourse(keys, courseId, database)).size : keys.length;
});
