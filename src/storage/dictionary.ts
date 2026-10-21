import Dexie from "dexie";
import { unitKey } from "../domain/refs";
import type { LearningRef, LearningState, LessonItem, Phrase } from "../domain/types";
import { moduleViews } from "./course";
import type { Language } from "../domain/language";
import { courseLessonIds, courses, primaryCourse } from "./courses";
import { db, searchTokens, type AppDatabase, type StoredWord } from "./db";
import { stateGroup } from "./queries";
import { rowCache } from "./row-cache";
import { zoned } from "./zone";

export type CardMark = "new" | "learning" | "solid";
export interface DictionaryEntry {
  key: string;
  ref: LearningRef;
  greek: string;
  russian: string;
  mark: CardMark;
  word?: StoredWord;
  phrase?: Phrase;
  tokens: string[];
}
export interface DictionaryLesson {
  id: string;
  /** Курс урока: в словаре языка — подпись строки и фильтр «Курс». */
  courseId: string | undefined;
  moduleId: string;
  moduleNumber: number;
  moduleTitle: string;
  /** «1.2» для урока модуля; у контрольной и повторения номера нет. */
  number: string | null;
  title: string;
  entries: DictionaryEntry[];
}

/**
 * Словарь курса (без курса — основного): слова и фразы скачанных уроков в порядке программы. Карточка стоит
 * в уроке, где введена впервые; повтор в следующих уроках её не дублирует. «Учу» — и изучение, и повторение
 * до закрепления.
 */
export const dictionary = zoned(async function dictionary(
  courseId?: string,
  database: AppDatabase = db,
): Promise<DictionaryLesson[]> {
  courseId ??= await primaryCourse(database);
  const lessons = (await moduleViews(courseId, database)).flatMap((view) => [
    ...view.lessons.map((lesson, index) => ({ view, lesson, number: `${view.module.number}.${index + 1}` })),
    ...[...(view.checkpoint ? [view.checkpoint] : []), ...view.review].map((lesson) => ({
      view,
      lesson,
      number: null,
    })),
  ]);
  const inCourse = new Set(lessons.map(({ lesson }) => lesson.id));
  // Уроки вне модулей остаются в старых профилях: их слова — в конце словаря, без модуля и без ссылки на урок.
  const own = courseId ? new Set(await courseLessonIds(courseId, database)) : undefined;
  const loose = (await database.lessons.toArray())
    .filter((lesson) => !inCourse.has(lesson.id) && (!own || own.has(lesson.id)))
    .map((lesson) => ({
      view: { module: { id: "", number: 0, title: "" } },
      lesson: { id: lesson.id, title: lesson.title, installed: true },
      number: null,
    }));
  const installed = [...lessons.filter(({ lesson }) => lesson.installed), ...loose];
  // Строки ниже берутся из кэша, поэтому подписка — на таблицы целиком: `count` не читает строк.
  await Promise.all(
    [database.lessonItems, database.words, database.phrases, database.cardStates].map((t) => t.count()),
  );
  const items = (
    await links(
      installed.map(({ lesson }) => lesson.id),
      database,
      (ids) => Promise.all(ids.map((id) => linksOf(id, database))),
    )
  ).map((list) => list ?? []);
  const refs = items.flat().map((item) => item.ref);
  const ids = (kind: LearningRef["kind"]) => [...new Set(refs.filter((ref) => ref.kind === kind).map((ref) => ref.id))];
  const wordIds = ids("word");
  const phraseIds = ids("phrase");
  const stateKeys = refs.map(unitKey);
  const [words, phrases, states] = await Promise.all([
    wordRows(wordIds, database, (keys) => database.words.bulkGet(keys)),
    phraseRows(phraseIds, database, (keys) => database.phrases.bulkGet(keys)),
    stateRows(stateKeys, database, (keys) => database.cardStates.bulkGet(keys)),
  ]);
  const wordById = new Map(wordIds.map((id, index) => [id, words[index]]));
  const phraseById = new Map(phraseIds.map((id, index) => [id, phrases[index]]));
  const stateByKey = new Map(stateKeys.map((key, index) => [key, states[index]]));
  const previous = shown.get(database)?.get(courseId) ?? new Map<string, DictionaryLesson>();
  const previousEntries = new Map([...previous.values()].flatMap((lesson) => lesson.entries.map((e) => [e.key, e])));
  const seen = new Set<string>();
  const result = installed.map(({ view, lesson, number }, index): DictionaryLesson => {
    const entries: DictionaryEntry[] = [];
    for (const item of items[index]) {
      if (seen.has(item.unitKey)) continue;
      const word = item.ref.kind === "word" ? wordById.get(item.ref.id) : undefined;
      const phrase = item.ref.kind === "phrase" ? phraseById.get(item.ref.id) : undefined;
      if (!word && !phrase) continue;
      seen.add(item.unitKey);
      const group = stateGroup(stateByKey.get(item.unitKey));
      const mark: CardMark = group === "new" ? "new" : group === "solid" ? "solid" : "learning";
      const before = previousEntries.get(item.unitKey);
      if (before && before.word === word && before.phrase === phrase && before.mark === mark) {
        entries.push(before);
        continue;
      }
      const greek = word?.greek ?? phrase!.text;
      const russian = word?.russian ?? phrase!.translation ?? "";
      entries.push({
        key: item.unitKey,
        ref: item.ref,
        greek,
        russian,
        mark,
        word,
        phrase,
        tokens: searchTokens(`${greek} ${russian}`),
      });
    }
    const next: DictionaryLesson = {
      id: lesson.id,
      courseId,
      moduleId: view.module.id,
      moduleNumber: view.module.number,
      moduleTitle: view.module.title,
      number,
      title: lesson.title,
      entries,
    };
    const before = previous.get(lesson.id);
    return before && sameLesson(before, next) ? before : next;
  });
  if (!Dexie.currentTransaction) {
    const byCourse = shown.get(database) ?? new Map<string | undefined, Map<string, DictionaryLesson>>();
    byCourse.set(courseId, new Map(result.map((lesson) => [lesson.id, lesson])));
    shown.set(database, byCourse);
  }
  return result;
});

/** Словарь языка: словари его начатых курсов по порядку курсов; карточка принадлежит одному курсу, дублей нет. */
export const languageDictionary = zoned(async function languageDictionary(
  language: Language | undefined,
  database: AppDatabase = db,
): Promise<DictionaryLesson[]> {
  const own = (await courses(database)).filter((course) => course.language === language && course.started);
  return (await Promise.all(own.map((course) => dictionary(course.id, database)))).flat();
});

const links = rowCache<LessonItem[]>("lessonItems", (key) =>
  Array.isArray(key) && typeof key[0] === "string" ? key[0] : undefined,
);
/**
 * Ключи и `bulkGet`, а не запрос со строками: такой запрос в живом запросе Dexie отдаёт с ещё не зафиксированной
 * записью вне явной транзакции, и после её отката кэш хранил бы строки, которых нет.
 */
const linksOf = zoned(async function linksOf(lessonId: string, database: AppDatabase): Promise<LessonItem[]> {
  const keys = await database.lessonItems
    .where("[lessonId+position]")
    .between([lessonId, Dexie.minKey], [lessonId, Dexie.maxKey])
    .primaryKeys();
  return (await database.lessonItems.bulkGet(keys)).filter((item): item is LessonItem => !!item);
});
const wordRows = rowCache<StoredWord>("words");
const phraseRows = rowCache<Phrase>("phrases");
const stateRows = rowCache<LearningState>("cardStates");
/** Прежний результат по курсу: неизменившиеся уроки возвращаются теми же объектами и не перерисовываются. */
const shown = new WeakMap<AppDatabase, Map<string | undefined, Map<string, DictionaryLesson>>>();

const sameLesson = (a: DictionaryLesson, b: DictionaryLesson) =>
  a.courseId === b.courseId &&
  a.moduleId === b.moduleId &&
  a.moduleNumber === b.moduleNumber &&
  a.moduleTitle === b.moduleTitle &&
  a.number === b.number &&
  a.title === b.title &&
  a.entries.length === b.entries.length &&
  a.entries.every((entry, index) => entry === b.entries[index]);

export type MarkFilter = CardMark | "all";

/**
 * Урок, где подошло всё, возвращается тем же объектом, чтобы его строки не перерисовывались. Курс, которого в
 * словаре нет (из адреса другого языка), не фильтрует.
 */
export function filterDictionary(lessons: DictionaryLesson[], filter: MarkFilter, query: string, course?: string) {
  const wanted = searchTokens(query);
  const byCourse = !!course && lessons.some((lesson) => lesson.courseId === course);
  if (filter === "all" && !wanted.length && !byCourse) return lessons;
  const fits = (entry: DictionaryEntry) =>
    (filter === "all" || entry.mark === filter) &&
    wanted.every((token) => entry.tokens.some((own) => own.startsWith(token)));
  return lessons.flatMap((lesson) => {
    if (byCourse && lesson.courseId !== course) return [];
    const entries = lesson.entries.filter(fits);
    if (!entries.length) return [];
    return entries.length === lesson.entries.length ? [lesson] : [{ ...lesson, entries }];
  });
}

export function countMarks(lessons: DictionaryLesson[]) {
  const counts: Record<MarkFilter, number> = { all: 0, new: 0, learning: 0, solid: 0 };
  for (const lesson of lessons)
    for (const entry of lesson.entries) {
      counts.all++;
      counts[entry.mark]++;
    }
  return counts;
}
