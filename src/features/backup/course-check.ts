import type { AppDatabase } from "../../storage/db";
import { blockKey } from "../../storage/course";

export interface CourseRows {
  lessons: unknown[];
  courses: unknown[];
  packages: unknown[];
  blockProgress: unknown[];
}
type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isoDate = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));

function blockRowProblem(row: unknown): string | null {
  if (!record(row)) return "запись не является объектом";
  const { key, lessonId, blockId, done, updatedAt, score, checks, answers } = row;
  if (!text(lessonId) || !text(blockId)) return "нет урока или блока";
  if (key !== blockKey(lessonId, blockId)) return `ключ «${String(key)}» не совпадает с «${lessonId}/${blockId}»`;
  if (typeof done !== "boolean") return `у блока ${key} нет отметки выполнения`;
  if (!isoDate(updatedAt)) return `у блока ${key} нет даты изменения`;
  if (score !== undefined && !(record(score) && count(score.correct) && count(score.almost) && count(score.total)))
    return `у блока ${key} некорректный счёт`;
  if (checks !== undefined && !(Array.isArray(checks) && checks.every((item) => Number.isInteger(item))))
    return `у блока ${key} некорректные критерии`;
  if (answers !== undefined && !(record(answers) && Object.values(answers).every((item) => typeof item === "string")))
    return `у блока ${key} некорректные ответы`;
  if (row.text !== undefined && typeof row.text !== "string") return `у блока ${key} некорректный текст`;
  return null;
}

/** Уроки, о которых знает эта установка: каталог и модули программы — кеш, его может ещё не быть. */
async function installedCourse(database: AppDatabase): Promise<Set<string>> {
  try {
    const [catalog, modules] = await Promise.all([
      database.catalog.toCollection().primaryKeys(),
      database.modules.toArray(),
    ]);
    return new Set([
      ...catalog.map(String),
      ...modules.flatMap((module) => [
        ...module.lessonIds,
        ...(module.reviewIds ?? []),
        ...(module.checkpointId ? [module.checkpointId] : []),
      ]),
    ]);
  } catch {
    return new Set();
  }
}

/**
 * Прогресс курса копии ссылается только на уроки, известные копии (строки уроков, пакеты) или каталогу этой
 * установки. Блоки неустановленных уроков законны — так их хранит синхронизация, — но урок обязан существовать.
 */
export async function courseProblem(rows: CourseRows, database: AppDatabase): Promise<string | null> {
  for (const lesson of rows.lessons) {
    if (!record(lesson) || !text(lesson.id)) return "Копия повреждена: урок без идентификатора.";
    if (lesson.status !== undefined && lesson.status !== "upcoming" && lesson.status !== "completed")
      return `Копия повреждена: у урока ${lesson.id} неизвестный статус «${JSON.stringify(lesson.status)}».`;
    if (lesson.completed !== undefined && typeof lesson.completed !== "boolean")
      return `Копия повреждена: у урока ${lesson.id} некорректная отметка завершения.`;
  }
  for (const row of rows.blockProgress) {
    const problem = blockRowProblem(row);
    if (problem) return `Копия повреждена: прогресс блока — ${problem}.`;
  }
  const packaged = new Set(rows.packages.filter(record).map((pack) => String(pack.lessonId)));
  const inFile = new Set([...packaged, ...rows.lessons.filter(record).map((lesson) => String(lesson.id))]);
  // В копии v8 есть курс «Мои слова» с `origin: "local"`: его уроки не из каталога.
  const contentCourses = new Set(
    rows.courses
      .filter((course) => record(course) && course.origin !== "local")
      .map((course) => String((course as Row).id)),
  );
  const contentLessons = rows.lessons.filter(
    (lesson): lesson is Row =>
      record(lesson) && contentCourses.has(String(lesson.courseId)) && !packaged.has(String(lesson.id)),
  );
  const orphanBlocks = (rows.blockProgress as Row[]).filter((row) => !inFile.has(String(row.lessonId)));
  if (!contentLessons.length && !orphanBlocks.length) return null;
  const installed = await installedCourse(database);
  // Без каталога строку урока проверить не с чем: она пришла с пакетом, который могли удалить.
  const strange = installed.size ? contentLessons.find((lesson) => !installed.has(String(lesson.id))) : undefined;
  if (strange) return `Копия ссылается на урок курса ${String(strange.id)}, которого нет в каталоге.`;
  const orphan = orphanBlocks.find((row) => !installed.has(String(row.lessonId)));
  if (orphan)
    return `Копия ссылается на урок ${String(orphan.lessonId)}, которого нет ни в копии, ни в каталоге курса. Если каталог ещё не загружен, откройте «Курс» и повторите.`;
  return null;
}
