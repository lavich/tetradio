/** «Сегодня» по языкам: язык «Сегодня», курсы языка на «Сегодня» и общий план языка. */
import type { Language } from "../domain/language";
import { makeLanguagePlan, makePlan, type DailyPlan } from "../domain/learning";
import { courses, primaryCourse, todayCourse, type CourseEntry } from "./courses";
import { db, type AppDatabase } from "./db";
import { dexieSource } from "./queries";
import { zoned } from "./zone";

/**
 * Язык «Сегодня» — язык основного курса, пока у языка есть начатый курс не на паузе; иначе язык курса «Сегодня»
 * (следующего по кругу). `undefined` — все начатые курсы на паузе; `null` — курсов в каталоге нет.
 */
export const todayLanguage = zoned(async function todayLanguage(
  database: AppDatabase = db,
): Promise<Language | null | undefined> {
  const [list, primary] = await Promise.all([courses(database), primaryCourse(database)]);
  const own = list.find((course) => course.id === primary);
  if (!own) return null;
  const started = list.filter((course) => course.started);
  if (!started.length) return own.language;
  if (started.some((course) => course.language === own.language && !course.pausedAt)) return own.language;
  const next = await todayCourse(database);
  return next ? list.find((course) => course.id === next)?.language : undefined;
});

/**
 * Начатые курсы языка не на паузе. Первый — основной курс языка: в языке «Сегодня» — первый курс языка по кругу
 * порядка курсов от основного, в другом языке — первый по порядку; остальные — по порядку курсов. Пока ничего не
 * начато — основной курс: его план охватывает и уроки прежней версии без курса.
 */
export const todayCourses = zoned(async function todayCourses(
  language: Language,
  database: AppDatabase = db,
): Promise<CourseEntry[]> {
  const [list, primary, shown] = await Promise.all([
    courses(database),
    primaryCourse(database),
    todayLanguage(database),
  ]);
  const started = list.filter((course) => course.started);
  if (!started.length) return list.filter((course) => course.id === primary && course.language === language);
  const own = started.filter((course) => course.language === language && !course.pausedAt);
  if (language !== shown || !own.length) return own;
  const from = Math.max(
    0,
    started.findIndex((course) => course.id === primary),
  );
  for (let step = 0; step < started.length; step++) {
    const course = started[(from + step) % started.length];
    if (own.includes(course)) return [course, ...own.filter((other) => other !== course)];
  }
  return own;
});

/** План языка; `null` — курсов в каталоге нет: план по всем урокам, как до курсов. */
export const languagePlan = zoned(async function languagePlan(
  now: Date,
  language: Language | null,
  database: AppDatabase = db,
): Promise<DailyPlan> {
  const source = dexieSource(database);
  if (language === null) return makePlan(source, now);
  const courseIds = (await todayCourses(language, database)).map((course) => course.id);
  return makeLanguagePlan(source, now, { courseIds });
});
