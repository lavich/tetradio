import type { CatalogModule } from "../content/course";
import { decodeMarks, type BlockMarks, type PackageReading } from "../content/schema";
import type { InstalledPackage, StoredModule } from "../domain/types";
import type { Language } from "../domain/language";
import { blockKey, saveBlockProgress, type TapCard } from "./course";
import { courses, type CourseEntry } from "./courses";
import { db, type AppDatabase } from "./db";
import { lessonOutlines, type LessonOutline } from "./outlines";
import { zoned } from "./zone";

/** Отметка «прочитано» — строка блока текста: ключ `<текст>/read` переносится синхронизацией как блок урока. */
const READ_BLOCK = "read";

export interface ReadingView {
  reading: PackageReading;
  moduleId: string;
  module: { number: number; title: string };
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

/** Уроки курса в порядке программы: модули по номеру, внутри — уроки, контрольная точка, занятия после пробника. */
const lessonsOf = (module: CatalogModule) => [
  ...module.lessonIds,
  ...(module.checkpointId ? [module.checkpointId] : []),
  ...(module.reviewIds ?? []),
];

const views = zoned(async function views(
  packages: InstalledPackage[],
  database: AppDatabase,
  known?: StoredModule[],
): Promise<ReadingView[]> {
  const modules = known ?? (await database.modules.toArray()).sort((a, b) => a.number - b.number);
  const order = new Map(modules.flatMap(lessonsOf).map((id, index) => [id, index]));
  const withTexts = packages
    .filter(
      (pack): pack is InstalledPackage & { module: { id: string; position: number } } =>
        !!pack.module && !!pack.readings?.length,
    )
    .sort(
      (a, b) =>
        (order.get(a.lessonId) ?? Infinity) - (order.get(b.lessonId) ?? Infinity) ||
        a.module.position - b.module.position ||
        a.lessonId.localeCompare(b.lessonId, undefined, { numeric: true }),
    );
  const lessons = await database.lessons.bulkGet(withTexts.map((pack) => pack.lessonId));
  const readings = withTexts.flatMap((pack, index) =>
    pack.readings!.map((reading) => ({ reading, pack, lesson: lessons[index] })),
  );
  const marks = await database.blockProgress.bulkGet(readings.map(({ reading }) => blockKey(reading.id, READ_BLOCK)));
  return readings.map(({ reading, pack, lesson }, index) => {
    const module = modules.find((item) => item.id === pack.module.id);
    return {
      reading,
      moduleId: pack.module.id,
      module: { number: module?.number ?? pack.module.position + 1, title: module?.title ?? pack.module.id },
      after: { id: pack.lessonId, title: lesson?.title ?? pack.lessonId, position: pack.module.position },
      open: !!lesson?.completed,
      ...(marks[index]?.done ? { readAt: marks[index]!.updatedAt } : {}),
    };
  });
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

export interface CourseReadings {
  /** Открытые тексты в порядке программы. */
  open: ReadingView[];
  unread: ReadingView[];
  /** Тексты курса, открывающие уроки которых не пройдены. */
  closed: number;
  /** Урок, после которого откроется ближайший закрытый текст. */
  closedAfter?: { id: string; title: string };
  /** Тексты пройденных уроков, пакеты которых на устройстве ещё не скачаны: счёт открытых пока неполный. */
  pending: number;
}

/**
 * Тексты курса для «Сегодня» и раздела «Чтение». Закрытые и ждущие скачивания считаются по каталогу:
 * пакеты закрытых уроков не читаются, а число не зависит от того, в какие модули учащийся уже заходил.
 */
export const courseReadings = zoned(async function courseReadings(
  courseId: string,
  database: AppDatabase = db,
): Promise<CourseReadings> {
  const modules = (await database.modules.where("courseId").equals(courseId).toArray()).sort(
    (a, b) => a.number - b.number,
  );
  const ids = modules.flatMap(lessonsOf);
  const [lessons, entries] = await Promise.all([database.lessons.bulkGet(ids), database.catalog.bulkGet(ids)]);
  const completed: { id: string; count: number }[] = [];
  let closed = 0;
  let closedAfter: CourseReadings["closedAfter"];
  ids.forEach((id, index) => {
    const count = entries[index]?.readings ?? 0;
    if (!count) return;
    if (lessons[index]?.completed) return void completed.push({ id, count });
    closed += count;
    closedAfter ??= { id, title: entries[index]?.title ?? lessons[index]?.title ?? id };
  });
  const doneIds = completed.map(({ id }) => id);
  const outlines = await lessonOutlines(doneIds, database);
  const pending = completed.reduce(
    (sum, { count }, index) => sum + Math.max(0, count - (outlines[index]?.readings.length ?? 0)),
    0,
  );
  const open = (await views(await packagesWith(doneIds, () => true, database), database, modules)).filter(
    (view) => view.open,
  );
  return {
    open,
    unread: open.filter((view) => !view.readAt),
    closed,
    ...(closedAfter ? { closedAfter } : {}),
    pending,
  };
});

export interface LanguageReadings {
  /** Начатые курсы языка с текстами — открытыми, закрытыми или ждущими скачивания — по порядку курсов. */
  groups: { course: CourseEntry; readings: CourseReadings }[];
  open: number;
  unread: number;
  pending: number;
}

/** Тексты начатых курсов языка для раздела «Чтение»: сводка — по всему языку, закрытые — у курса. */
export const languageReadings = zoned(async function languageReadings(
  language: Language | undefined,
  database: AppDatabase = db,
): Promise<LanguageReadings> {
  const own = (await courses(database)).filter((course) => course.language === language && course.started);
  const all = await Promise.all(
    own.map(async (course) => ({ course, readings: await courseReadings(course.id, database) })),
  );
  const groups = all.filter(({ readings }) => readings.open.length || readings.closed || readings.pending);
  const sum = (count: (readings: CourseReadings) => number) =>
    groups.reduce((total, { readings }) => total + count(readings), 0);
  return {
    groups,
    open: sum((readings) => readings.open.length),
    unread: sum((readings) => readings.unread.length),
    pending: sum((readings) => readings.pending),
  };
});

/** Следующий непрочитанный текст курса после данного в порядке программы, в том числе в другом модуле. */
export const nextUnreadReading = zoned(async function nextUnreadReading(
  courseId: string,
  afterId: string,
  database: AppDatabase = db,
): Promise<ReadingView | undefined> {
  const { open } = await courseReadings(courseId, database);
  const at = open.findIndex((view) => view.reading.id === afterId);
  if (at < 0) return undefined;
  return open.slice(at + 1).find((view) => !view.readAt);
});

export const markRead = (id: string, done: boolean, database: AppDatabase = db) =>
  saveBlockProgress(id, READ_BLOCK, { done }, database);
