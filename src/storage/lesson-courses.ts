import { db, type AppDatabase } from "./db";
import { zoned } from "./zone";

/** Курс урока: из записи урока, для неустановленного или старого урока — из каталога. */
export const lessonCourses = zoned(async function lessonCourses(
  lessonIds: string[],
  database: AppDatabase = db,
): Promise<Map<string, string>> {
  const ids = [...new Set(lessonIds)];
  const [lessons, entries] = await Promise.all([database.lessons.bulkGet(ids), database.catalog.bulkGet(ids)]);
  const result = new Map<string, string>();
  ids.forEach((id, index) => {
    const course = lessons[index]?.courseId ?? entries[index]?.courseId;
    if (course) result.set(id, course);
  });
  return result;
});
