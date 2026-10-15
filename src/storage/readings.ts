import { decodeMarks, type BlockMarks, type PackageReading } from "../content/schema";
import type { InstalledPackage } from "../domain/types";
import { blockKey, saveBlockProgress, type TapCard } from "./course";
import { courseLessonIds } from "./courses";
import { db, type AppDatabase } from "./db";
import { lessonOutlines, type LessonOutline } from "./outlines";
import { zoned } from "./zone";

/** Отметка «прочитано» — строка блока текста: ключ `<текст>/read` переносится синхронизацией как блок урока. */
const READ_BLOCK = "read";

export interface ReadingView {
  reading: PackageReading;
  moduleId: string;
  /** Урок, после прохождения которого текст открыт. */
  after: { id: string; title: string; position: number };
  open: boolean;
  readAt?: string;
}
export interface ReadingPage extends ReadingView {
  marks: BlockMarks;
  cards: Map<string, TapCard>;
  next?: ReadingView;
}

const views = zoned(async function views(packages: InstalledPackage[], database: AppDatabase): Promise<ReadingView[]> {
  const withTexts = packages
    .filter(
      (pack): pack is InstalledPackage & { module: { id: string; position: number } } =>
        !!pack.module && !!pack.readings?.length,
    )
    .sort((a, b) => a.module.position - b.module.position);
  const lessons = await database.lessons.bulkGet(withTexts.map((pack) => pack.lessonId));
  const readings = withTexts.flatMap((pack, index) =>
    pack.readings!.map((reading) => ({ reading, pack, lesson: lessons[index] })),
  );
  const marks = await database.blockProgress.bulkGet(readings.map(({ reading }) => blockKey(reading.id, READ_BLOCK)));
  return readings.map(({ reading, pack, lesson }, index) => ({
    reading,
    moduleId: pack.module.id,
    after: { id: pack.lessonId, title: lesson?.title ?? pack.lessonId, position: pack.module.position },
    open: !!lesson?.completed,
    ...(marks[index]?.done ? { readAt: marks[index]!.updatedAt } : {}),
  }));
});
/** Пакеты целиком весят мегабайты: выбор — по сводкам, читаются только пакеты с нужными текстами. */
const packagesWith = zoned(async function packagesWith(
  ids: string[],
  wanted: (outline: LessonOutline, id: string) => boolean,
  database: AppDatabase,
): Promise<InstalledPackage[]> {
  const outlines = await lessonOutlines(ids, database);
  const chosen = ids.filter((id, index) => {
    const outline = outlines[index];
    return !!outline?.readings.length && wanted(outline, id);
  });
  return (await database.packages.bulkGet(chosen)).filter((pack): pack is InstalledPackage => !!pack);
});
const installedIds = zoned(
  async (database: AppDatabase) => (await database.packages.toCollection().primaryKeys()) as string[],
);
const modulePackages = zoned(async (moduleId: string, database: AppDatabase) =>
  packagesWith(await installedIds(database), (outline) => outline.module?.id === moduleId, database),
);

/** Тексты модуля в порядке программы: по месту открывающего урока, внутри урока — по порядку пакета. */
export const moduleReadings = zoned(async (moduleId: string, database: AppDatabase = db) =>
  views(await modulePackages(moduleId, database), database),
);

/** Экран текста: сам текст, разметка слов, карточки подсказок и следующий текст модуля. */
export const readingPage = zoned(async function readingPage(
  id: string,
  database: AppDatabase = db,
): Promise<ReadingPage | null> {
  const ids = await installedIds(database);
  const owner = (await lessonOutlines(ids, database)).find((outline) => outline?.readings.includes(id));
  if (!owner?.module) return null;
  const all = await moduleReadings(owner.module.id, database);
  const at = all.findIndex((view) => view.reading.id === id);
  // Сводка могла устареть: пакет обновился между выбором владельца и чтением.
  if (at < 0) return null;
  const view = all[at];
  return {
    ...view,
    marks: view.reading.marks ? decodeMarks(view.reading.marks, []) : {},
    cards: new Map((view.reading.marks?.cards ?? []).map((card): [string, TapCard] => [card.ref, card])),
    ...(all[at + 1] ? { next: all[at + 1] } : {}),
  };
});

/** Первый открытый непрочитанный текст курса — строка «Почитать» на «Сегодня». */
export const nextReading = zoned(async function nextReading(
  courseId: string,
  database: AppDatabase = db,
): Promise<ReadingView | undefined> {
  // Текст закрытого урока «Сегодня» не предлагает: пакеты непройденных уроков не читаются.
  const completed = (await database.lessons.toArray()).flatMap((lesson) => (lesson.completed ? [lesson.id] : []));
  const packages = await packagesWith(completed, () => true, database);
  const modules = new Map((await database.modules.toArray()).map((module) => [module.id, module.number]));
  const all = await views(packages, database);
  const own = new Set(await courseLessonIds(courseId, database));
  return all
    .filter((view) => own.has(view.after.id) && view.open && !view.readAt)
    .sort((a, b) => (modules.get(a.moduleId) ?? 0) - (modules.get(b.moduleId) ?? 0))[0];
});

export const markRead = (id: string, done: boolean, database: AppDatabase = db) =>
  saveBlockProgress(id, READ_BLOCK, { done }, database);
