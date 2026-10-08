import { rememberCourses } from "../storage/courses";
import { db, type AppDatabase, type StoredCatalogEntry } from "../storage/db";
import { readPending } from "../sync/snapshot";
import type { Course } from "../domain/types";
import { fetcher, type ContentFetcher } from "./fetcher";
import { installCourse } from "./install";
import { setCatalogPhase, trackCatalog } from "./phases";
import { parseCatalog, type Catalog } from "./schema";

export function refreshCatalog(database: AppDatabase = db, source: ContentFetcher = fetcher): Promise<Catalog> {
  const request = loadCatalog(database, source);
  trackCatalog(request);
  return request;
}

async function loadCatalog(database: AppDatabase, source: ContentFetcher): Promise<Catalog> {
  setCatalogPhase("loading"); // повтор после сбоя снова ждёт; после первого успеха фаза не меняется
  try {
    const catalog = parseCatalog(await source.json("content/catalog.json"));
    const tables = [database.catalog, database.modules, database.courses, database.lessons, database.meta];
    await database.transaction("rw", tables, async () => {
      await database.catalog.clear();
      await database.catalog.bulkAdd(catalog.lessons.map((entry, position) => ({ ...entry, position })));
      // Модули — кеш каталога, как и записи уроков: черновики видны описанием, их уроки не поставляются.
      await database.modules.clear();
      await database.modules.bulkAdd((catalog.modules ?? []).map((module, position) => ({ ...module, position })));
      await adoptCourses(catalog, database);
      await rememberCourses(database);
      await database.meta.put({ key: "catalogUpdatedAt", value: new Date().toISOString() });
    });
    setCatalogPhase("ready");
    return catalog;
  } catch (error) {
    setCatalogPhase("error");
    throw error;
  }
}

/** Первый в порядке каталога урок, в состав которого входит слово: одно слово бывает в нескольких уроках. */
export function firstLessonOf(entries: StoredCatalogEntry[], wordId: string): StoredCatalogEntry | null {
  const order = (entry: StoredCatalogEntry) => entry.position ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...entries].sort((a, b) => order(a) - order(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted.find((entry) => entry.wordIds?.includes(wordId)) ?? null;
}
export async function lessonOfWord(wordId: string, database: AppDatabase = db): Promise<StoredCatalogEntry | null> {
  return firstLessonOf(await database.catalog.toArray(), wordId);
}

/**
 * Каталог — единственное место, где известен курс урока, установленного прежней версией.
 * Название и экзамен курса берутся из каталога, дневной предел остаётся пользовательским.
 */
async function adoptCourses(catalog: Catalog, database: AppDatabase) {
  const now = new Date().toISOString();
  const courseOf = new Map(catalog.lessons.map((entry) => [entry.id, entry.courseId]));
  for (const lesson of await database.lessons.toArray()) {
    const courseId = courseOf.get(lesson.id);
    if (courseId && !lesson.courseId) await database.lessons.put({ ...lesson, courseId });
  }
  for (const item of catalog.courses) {
    const stored = await database.courses.get(item.id);
    const next: Course = {
      id: item.id,
      title: item.title,
      updatedAt: stored?.updatedAt ?? now,
    };
    if (item.exam) next.exam = item.exam;
    if (item.passShare !== undefined) next.passShare = item.passShare;
    if (item.calendar) next.calendar = item.calendar;
    if (
      !stored ||
      stored.title !== next.title ||
      JSON.stringify(stored.exam) !== JSON.stringify(next.exam) ||
      stored.passShare !== next.passShare ||
      JSON.stringify(stored.calendar) !== JSON.stringify(next.calendar)
    )
      await database.courses.put({ ...next, updatedAt: now });
  }
}

/**
 * Фоновая догрузка начатых курсов: вызывается после обновления каталога при запуске. Курс начат, если у него есть
 * уроки на устройстве или пройденные на другом устройстве уроки ждут установки после синхронизации.
 */
export async function syncCourses(database: AppDatabase = db, source: ContentFetcher = fetcher): Promise<void> {
  const pending = (await database.catalog.bulkGet(Object.keys(await readPending(database)))).map(
    (entry) => entry?.courseId,
  );
  const started = new Set([...(await database.lessons.orderBy("courseId").uniqueKeys()).map(String), ...pending]);
  for (const id of await database.courses.toCollection().primaryKeys())
    if (started.has(id)) await installCourse(id, database, source);
}
