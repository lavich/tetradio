/**
 * Несколько курсов на устройстве: порядок курсов и основной курс, курс экранов «Курс», «Слова», «Прогресс»,
 * курс карточки и язык курса. Порядок и выбранный курс — настройки устройства в `meta`: в облако не идут.
 */
import Dexie from "dexie";
import { DEFAULT_LANGUAGE, isLanguage, profileOf, type Language, type LanguageProfile } from "../domain/language";
import { unitKey } from "../domain/refs";
import type { CardKind, LearningRef, Session } from "../domain/types";
import { db, type AppDatabase } from "./db";

export const COURSES_ORDER_KEY = "coursesOrder";
export const CURRENT_COURSE_KEY = "currentCourse";

export interface CourseEntry {
  id: string;
  title: string;
  language: Language;
  profile: LanguageProfile;
  /** На устройстве есть уроки курса. */
  installed: boolean;
}

// Курс в базе язык не хранит: он есть у записей каталога его уроков.
export async function courseLanguage(courseId: string, database: AppDatabase = db): Promise<Language> {
  const language = (await database.catalog.where("courseId").equals(courseId).first())?.language;
  return isLanguage(language) ? language : DEFAULT_LANGUAGE;
}
export const profileOfCourse = async (courseId: string, database: AppDatabase = db) =>
  profileOf(await courseLanguage(courseId, database));

const readOrder = async (database: AppDatabase): Promise<string[]> => {
  const raw = (await database.meta.get(COURSES_ORDER_KEY))?.value;
  try {
    const order = raw ? JSON.parse(raw) : [];
    return Array.isArray(order) ? order.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

/**
 * Курсы по порядку: сохранённый порядок, затем установленные, затем остальные — по месту в каталоге.
 * Греческий установлен первым, поэтому по умолчанию он и основной.
 */
export async function courses(database: AppDatabase = db): Promise<CourseEntry[]> {
  const [rows, entries, installedIds, stored] = await Promise.all([
    database.courses.toArray(),
    database.catalog.toArray(),
    database.lessons.orderBy("courseId").uniqueKeys(),
    readOrder(database),
  ]);
  const installed = new Set(installedIds.map(String));
  const rank = new Map<string, number>();
  const language = new Map<string, Language>();
  for (const entry of entries) {
    const position = entry.position ?? Number.MAX_SAFE_INTEGER;
    if (position < (rank.get(entry.courseId) ?? Number.MAX_SAFE_INTEGER)) rank.set(entry.courseId, position);
    if (!language.has(entry.courseId) && isLanguage(entry.language)) language.set(entry.courseId, entry.language);
  }
  const saved = new Map(stored.map((id, index) => [id, index]));
  const order = (id: string) => saved.get(id) ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...rows].sort(
    (a, b) =>
      order(a.id) - order(b.id) ||
      Number(installed.has(b.id)) - Number(installed.has(a.id)) ||
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id),
  );
  return sorted.map((course) => {
    const code = language.get(course.id) ?? DEFAULT_LANGUAGE;
    return {
      id: course.id,
      title: course.title,
      language: code,
      profile: profileOf(code),
      installed: installed.has(course.id),
    };
  });
}
/**
 * Запоминает установленные курсы в конце порядка: так порядок по умолчанию — порядок установки, а не место
 * курса в каталоге. Вызывается при обновлении каталога, в его транзакции.
 */
export async function rememberCourses(database: AppDatabase = db): Promise<void> {
  const [list, stored] = await Promise.all([courses(database), readOrder(database)]);
  const added = list.filter((course) => course.installed && !stored.includes(course.id)).map((course) => course.id);
  if (added.length) await database.meta.put({ key: COURSES_ORDER_KEY, value: JSON.stringify([...stored, ...added]) });
}
export const coursesOrder = async (database: AppDatabase = db) => (await courses(database)).map((course) => course.id);

/** Основной курс — первый установленный по порядку; пока ничего не установлено — первый курс каталога. */
export async function primaryCourse(database: AppDatabase = db): Promise<string | undefined> {
  const list = await courses(database);
  return (list.find((course) => course.installed) ?? list[0])?.id;
}
export async function setPrimaryCourse(courseId: string, database: AppDatabase = db): Promise<void> {
  const order = await coursesOrder(database);
  await database.meta.put({
    key: COURSES_ORDER_KEY,
    value: JSON.stringify([courseId, ...order.filter((id) => id !== courseId)]),
  });
}

/** Курс экранов «Курс», «Слова» и «Прогресс»: выбранный, а без выбора или с удалённым из каталога — основной. */
export async function currentCourse(database: AppDatabase = db): Promise<string | undefined> {
  const [chosen, known] = await Promise.all([
    database.meta.get(CURRENT_COURSE_KEY),
    database.courses.toCollection().primaryKeys(),
  ]);
  if (chosen && known.includes(chosen.value)) return chosen.value;
  return primaryCourse(database);
}
export const setCurrentCourse = (courseId: string, database: AppDatabase = db) =>
  database.meta.put({ key: CURRENT_COURSE_KEY, value: courseId }).then(() => undefined);

/** Курс урока: из записи урока, для неустановленного или старого урока — из каталога. */
export async function lessonCourses(lessonIds: string[], database: AppDatabase = db): Promise<Map<string, string>> {
  const ids = [...new Set(lessonIds)];
  const [lessons, entries] = await Promise.all([database.lessons.bulkGet(ids), database.catalog.bulkGet(ids)]);
  const result = new Map<string, string>();
  ids.forEach((id, index) => {
    const course = lessons[index]?.courseId ?? entries[index]?.courseId;
    if (course) result.set(id, course);
  });
  return result;
}

/** Курс карточки — курс урока, в котором она стоит: сборка не пускает карточку в уроки двух курсов. */
export async function courseOfCards(unitKeys: string[], database: AppDatabase = db): Promise<Map<string, string>> {
  if (!unitKeys.length) return new Map();
  const items = await database.lessonItems.where("unitKey").anyOf(unitKeys).toArray();
  const byLesson = await lessonCourses(
    items.map((item) => item.lessonId),
    database,
  );
  const result = new Map<string, string>();
  for (const item of items) {
    const course = byLesson.get(item.lessonId);
    if (course && !result.has(item.unitKey)) result.set(item.unitKey, course);
  }
  return result;
}

/** Карточка вне уроков (связь снята обновлением) остаётся у основного курса: так её повторение не теряется. */
export async function cardsInCourse(
  unitKeys: string[],
  courseId: string,
  database: AppDatabase = db,
): Promise<Set<string>> {
  const owners = await courseOfCards(unitKeys, database);
  const orphan = unitKeys.some((key) => !owners.has(key));
  const primary = orphan ? await primaryCourse(database) : undefined;
  return new Set(unitKeys.filter((key) => (owners.get(key) ?? primary) === courseId));
}

/** Язык карточки — язык её курса; карточка вне уроков — на языке основного курса. */
export async function cardLanguages(refs: LearningRef[], database: AppDatabase = db): Promise<Map<string, Language>> {
  const keys = refs.map(unitKey);
  const owners = await courseOfCards(keys, database);
  const primary = keys.some((key) => !owners.has(key)) ? await primaryCourse(database) : undefined;
  const ids = [...new Set([...owners.values(), ...(primary ? [primary] : [])])];
  const languages = new Map(
    await Promise.all(ids.map(async (id) => [id, await courseLanguage(id, database)] as const)),
  );
  return new Map(
    keys.map((key) => {
      const course = owners.get(key) ?? primary;
      return [key, (course && languages.get(course)) || DEFAULT_LANGUAGE];
    }),
  );
}

/** Уроки курса на устройстве; урок без курса (старый профиль) — у основного курса. */
export async function courseLessonIds(courseId: string, database: AppDatabase = db): Promise<string[]> {
  const lessons = await database.lessons.toArray();
  const owners = await lessonCourses(
    lessons.filter((lesson) => !lesson.courseId).map((lesson) => lesson.id),
    database,
  );
  const ownerOf = (id: string, own?: string) => own ?? owners.get(id);
  const primary = lessons.some((lesson) => !ownerOf(lesson.id, lesson.courseId))
    ? await primaryCourse(database)
    : undefined;
  return lessons
    .filter((lesson) => (ownerOf(lesson.id, lesson.courseId) ?? primary) === courseId)
    .map((lesson) => lesson.id);
}

/** Идентификаторы карточек вида в уроках курса, по порядку id. */
export async function courseCardIds(courseId: string, kind: CardKind, database: AppDatabase = db): Promise<string[]> {
  const lessonIds = await courseLessonIds(courseId, database);
  if (!lessonIds.length) return [];
  const items = await database.lessonItems.where("lessonId").anyOf(lessonIds).toArray();
  return [...new Set(items.filter((item) => item.ref.kind === kind).map((item) => item.ref.id))].sort();
}

/** Курс занятия; занятие прежней версии без курса — занятие основного курса. */
export const sessionCourse = async (session: Pick<Session, "courseId">, database: AppDatabase = db) =>
  session.courseId ?? primaryCourse(database);

/** Незавершённое занятие курса, последнее по времени; без курса — любое, как до двух курсов. */
export async function activeSession(courseId?: string, database: AppDatabase = db): Promise<Session | null> {
  const active = await database.sessions
    .where("[status+createdAt]")
    .between(["active", Dexie.minKey], ["active", Dexie.maxKey])
    .reverse()
    .toArray();
  if (!courseId) return active[0] ?? null;
  const primary = active.some((session) => !session.courseId) ? await primaryCourse(database) : undefined;
  return active.find((session) => (session.courseId ?? primary) === courseId) ?? null;
}
