/**
 * Несколько курсов на устройстве: порядок курсов, основной и домашний курс, языки курсов, язык «Курса» и язык «Слов»,
 * «Чтения», «Прогресса», курс карточки и язык курса. Порядок и выбор — настройки устройства в `meta`: в облако не идут.
 */
import Dexie from "dexie";
import { DEFAULT_PALETTE, isPalette, type PaletteName } from "../content/palettes";
import { DEFAULT_LANGUAGE, isLanguage, profileOf, type Language, type LanguageProfile } from "../domain/language";
import { unitKey } from "../domain/refs";
import { type CardKind, type LearningRef, type Lesson, type LessonItem, type Session } from "../domain/types";
import { db, distinctKeys, type AppDatabase } from "./db";
import { lessonCourses } from "./lesson-courses";
import { zoned } from "./zone";
import { readPending } from "./pending";
import { isPaused, readPauses } from "./pauses";

export { lessonCourses };

export const COURSES_ORDER_KEY = "coursesOrder";
/** Выбор курса прежней версии: из него выводится выбор языка, пока язык не выбран; откат читает его сам. */
export const CURRENT_COURSE_KEY = "currentCourse";
export const CURRENT_STARTED_COURSE_KEY = "currentStartedCourse";
export const CURRENT_LANGUAGE_KEY = "currentLanguage";
export const CURRENT_STARTED_LANGUAGE_KEY = "currentStartedLanguage";
export const HOME_COURSE_KEY = "homeCourse";
export const PRIMARY_COURSE_KEY = "primaryCourse";
export const SHELF_COURSE_KEY = "shelfCourse";
/** Курсы в работе из последнего каталога, JSON. */
export const UPCOMING_KEY = "upcomingCourses";

export interface UpcomingEntry {
  id: string;
  title: string;
  language: Language;
  level?: string;
  goal?: string;
  after?: string;
}

export const upcomingCourses = zoned(async function upcomingCourses(
  database: AppDatabase = db,
): Promise<UpcomingEntry[]> {
  try {
    const raw: unknown = JSON.parse((await database.meta.get(UPCOMING_KEY))?.value ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((item: UpcomingEntry) => typeof item?.id === "string" && isLanguage(item.language))
      : [];
  } catch {
    return [];
  }
});

export interface CourseEntry {
  id: string;
  title: string;
  language: Language;
  profile: LanguageProfile;
  /** На устройстве есть уроки курса. */
  installed: boolean;
  /** Курс начат: его уроки на устройстве или ждут установки из снимка другого устройства. */
  started: boolean;
  /** Имя курса внутри языка. */
  short?: string;
  level?: string;
  palette: PaletteName;
  /** Курс на паузе с этого момента. */
  pausedAt?: string;
}

export interface LanguageEntry {
  code: Language;
  title: string;
  /** Есть начатый курс, в том числе ждущий установки из снимка. */
  started: boolean;
  /** Уроки хотя бы одного курса языка на устройстве. */
  installed: boolean;
  /** Курсы языка по порядку курсов. */
  courses: CourseEntry[];
}

// Язык курса — у записей каталога его уроков; без них — у записи курса.
export const courseLanguage = zoned(async function courseLanguage(
  courseId: string,
  database: AppDatabase = db,
): Promise<Language> {
  const language = (await database.catalog.where("courseId").equals(courseId).first())?.language;
  if (isLanguage(language)) return language;
  const own = (await database.courses.get(courseId))?.language;
  return isLanguage(own) ? own : DEFAULT_LANGUAGE;
});
export const profileOfCourse = zoned(async (courseId: string, database: AppDatabase = db) =>
  profileOf(await courseLanguage(courseId, database)),
);

const readOrder = zoned(async (database: AppDatabase): Promise<string[]> => {
  const raw = (await database.meta.get(COURSES_ORDER_KEY))?.value;
  try {
    const order = raw ? JSON.parse(raw) : [];
    return Array.isArray(order) ? order.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
});

/**
 * Курсы по порядку установки, затем остальные — по месту курса (`order`), затем по месту уроков в каталоге. Порядок не зависит от основного курса: переключатели
 * не переставляют варианты после выбора. Курс, которого нет ни в каталоге, ни на устройстве, не показывается.
 */
export const courses = zoned((database: AppDatabase = db): Promise<CourseEntry[]> => readCourses(database, false));
const readCourses = zoned(async function readCourses(database: AppDatabase, hidden: boolean): Promise<CourseEntry[]> {
  const [rows, entries, installedIds, stored, pending, pauses] = await Promise.all([
    database.courses.toArray(),
    database.catalog.toArray(),
    distinctKeys(database.lessons, "courseId"),
    readOrder(database),
    readPending(database),
    readPauses(database),
  ]);
  const installed = new Set(installedIds.map(String));
  const waiting = new Set(entries.filter((entry) => entry.id in pending).map((entry) => entry.courseId));
  const rank = new Map<string, number>();
  const language = new Map<string, Language>();
  for (const entry of entries) {
    const position = entry.position ?? Number.MAX_SAFE_INTEGER;
    if (position < (rank.get(entry.courseId) ?? Number.MAX_SAFE_INTEGER)) rank.set(entry.courseId, position);
    if (!language.has(entry.courseId) && isLanguage(entry.language)) language.set(entry.courseId, entry.language);
  }
  const saved = new Map(stored.map((id, index) => [id, index]));
  const order = (id: string) => saved.get(id) ?? Number.MAX_SAFE_INTEGER;
  const sorted = rows
    // Загруженный каталог — единственный перечень курсов: курс вне его (скрытый флагом `hidden`) не показывается, данные остаются.
    .filter((row) => (entries.length && !hidden ? rank.has(row.id) : installed.has(row.id) || rank.has(row.id)))
    .sort(
      (a, b) =>
        order(a.id) - order(b.id) ||
        Number(installed.has(b.id)) - Number(installed.has(a.id)) ||
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
  return sorted.map((course) => {
    const code = language.get(course.id) ?? (isLanguage(course.language) ? course.language : DEFAULT_LANGUAGE);
    const pause = pauses[course.id];
    const started = installed.has(course.id) || waiting.has(course.id);
    return {
      id: course.id,
      title: course.title,
      language: code,
      profile: profileOf(code),
      installed: installed.has(course.id),
      started,
      ...(course.short ? { short: course.short } : {}),
      ...(course.level ? { level: course.level } : {}),
      palette: isPalette(course.palette) ? course.palette : DEFAULT_PALETTE,
      ...(started && isPaused(pause) ? { pausedAt: pause.pausedAt } : {}),
    };
  });
});
/**
 * Запоминает начатые курсы в конце порядка: так порядок по умолчанию — порядок начала, а не место курса в каталоге.
 * Первый курс порядка запоминается как домашний. Вызывается при обновлении каталога, в его транзакции, и при
 * установке урока. Записанный порядок не переставляется: на нём держатся домашний курс и привычный вид экранов.
 */
export async function rememberCourses(database: AppDatabase = db): Promise<void> {
  const [list, stored, home, startedAt] = await Promise.all([
    readCourses(database, true),
    readOrder(database),
    database.meta.get(HOME_COURSE_KEY),
    courseStarts(database),
  ]);
  const at = (id: string) => startedAt.get(id) ?? "\uffff";
  // Новое устройство ставит пакеты снимка по id, а не по времени начала: курс, начатый первым, может встать последним.
  const added = list
    .filter((course) => (course.installed || startedAt.has(course.id)) && !stored.includes(course.id))
    .map((course, index) => ({ id: course.id, index }))
    .sort((a, b) => (at(a.id) < at(b.id) ? -1 : at(a.id) > at(b.id) ? 1 : a.index - b.index))
    .map(({ id }) => id);
  if (added.length) await database.meta.put({ key: COURSES_ORDER_KEY, value: JSON.stringify([...stored, ...added]) });
  const first = [...stored, ...added].find((id) => list.some((course) => course.id === id));
  if (!home && first) await database.meta.put({ key: HOME_COURSE_KEY, value: first });
}

/** Самое раннее время уроков курса — на устройстве и в ожидающих установки из снимка: это время начала курса. */
const courseStarts = zoned(async function courseStarts(database: AppDatabase): Promise<Map<string, string>> {
  const [lessons, pending] = await Promise.all([database.lessons.toArray(), readPending(database)]);
  const waiting = Object.values(pending);
  const entries = await database.catalog.bulkGet(waiting.map((lesson) => lesson.id));
  const dated = [
    ...lessons.map((lesson) => ({ courseId: lesson.courseId, updatedAt: lesson.updatedAt })),
    ...waiting.map((lesson, index) => ({ courseId: entries[index]?.courseId, updatedAt: lesson.updatedAt })),
  ];
  const starts = new Map<string, string>();
  for (const { courseId, updatedAt } of dated) {
    if (!courseId || !updatedAt) continue;
    const known = starts.get(courseId);
    if (!known || updatedAt < known) starts.set(courseId, updatedAt);
  }
  return starts;
});

/**
 * Основной курс — выбранный в настройках, если он начат, иначе начатый первым; без начатых — первый в каталоге.
 * Начатым считается и курс, чьи уроки ещё ждут установки из снимка: на новом устройстве пакеты ставятся по id, и
 * основным иначе на время стал бы курс, чьи пакеты пришли раньше.
 */
export const primaryCourse = zoned(async function primaryCourse(
  database: AppDatabase = db,
): Promise<string | undefined> {
  const [list, chosen] = await Promise.all([courses(database), database.meta.get(PRIMARY_COURSE_KEY)]);
  const started = list.filter((course) => course.started);
  return (started.find((course) => course.id === chosen?.value) ?? started[0] ?? list[0])?.id;
});
/**
 * Курс «Сегодня»: основной, если он не на паузе; иначе следующий за ним по порядку курсов, по кругу, начатый и не на
 * паузе. `undefined` — все начатые курсы на паузе. Основной курс остальных экранов и владелец данных без курса —
 * по-прежнему `primaryCourse()`: пауза не должна переносить их в другой курс.
 */
export const todayCourse = zoned(async function todayCourse(database: AppDatabase = db): Promise<string | undefined> {
  const [list, primary] = await Promise.all([courses(database), primaryCourse(database)]);
  const started = list.filter((course) => course.started);
  if (!started.length) return primary;
  const from = Math.max(
    0,
    started.findIndex((course) => course.id === primary),
  );
  for (let step = 0; step < started.length; step++) {
    const course = started[(from + step) % started.length];
    if (!course.pausedAt) return course.id;
  }
  return undefined;
});
export const setPrimaryCourse = (courseId: string, database: AppDatabase = db) =>
  database.meta.put({ key: PRIMARY_COURSE_KEY, value: courseId }).then(() => undefined);

/**
 * Данные без курса — занятия и уроки прежней версии, карточки, снятые обновлением с уроков, — у домашнего курса:
 * установленного первым. Не у основного: иначе смена основного перенесла бы их в другой язык.
 */
export const homeCourse = zoned(async function homeCourse(database: AppDatabase = db): Promise<string | undefined> {
  return (await database.meta.get(HOME_COURSE_KEY))?.value ?? primaryCourse(database);
});

/**
 * Модуль, урок, слово или текст, открытые по ссылке, делают язык своего курса выбранным, а начатый курс — выбранным на «Курсе». Если он и так показан, а на
 * «Курсе» не выбран язык без установленных курсов, выбор не записывается: без явного выбора экраны следуют за языком
 * основного курса.
 */
export async function followCourse(courseId: string, database: AppDatabase = db): Promise<void> {
  const list = await courses(database);
  const course = list.find((item) => item.id === courseId);
  const language = course?.language;
  if (!course || !language) return;
  if (course.started && (await readShelfChoices(database))[language] !== courseId)
    await rememberShelfCourse(course, database);
  const [current, { chosen }] = await Promise.all([currentLanguage(database), readLanguageChoice(list, database)]);
  const unstartedChosen =
    !!chosen && chosen !== language && !list.some((course) => course.language === chosen && course.installed);
  if (current !== language || unstartedChosen) await setCurrentLanguage(language, database);
}

/** Языки курсов по порядку их первого курса: курс решает, есть ли язык в переключателях. */
export const languages = zoned(async function languages(database: AppDatabase = db): Promise<LanguageEntry[]> {
  const grouped = new Map<Language, CourseEntry[]>();
  for (const course of await courses(database))
    grouped.set(course.language, [...(grouped.get(course.language) ?? []), course]);
  return [...grouped].map(([code, list]) => ({
    code,
    title: profileOf(code).names.title,
    started: list.some((course) => course.started),
    installed: list.some((course) => course.installed),
    courses: list,
  }));
});

interface LanguageChoice {
  /** Выбор «Курса», бывает языком без начатых курсов. */
  chosen?: string;
  /** Последний выбранный язык с начатым курсом; пустая строка — такого выбора не было. */
  started?: string;
}
/**
 * Выбор языка; до первого выбора в новой версии — из прежнего выбора курса. Неначатый курс прежней версии без
 * начатого выбора значил «показать основной», поэтому выбора языка не даёт.
 */
const readLanguageChoice = zoned(async function readLanguageChoice(
  list: CourseEntry[],
  database: AppDatabase,
): Promise<LanguageChoice> {
  const [chosen, started, oldChosen, oldStarted] = await database.meta.bulkGet([
    CURRENT_LANGUAGE_KEY,
    CURRENT_STARTED_LANGUAGE_KEY,
    CURRENT_COURSE_KEY,
    CURRENT_STARTED_COURSE_KEY,
  ]);
  if (chosen) return { chosen: chosen.value, started: started?.value ?? "" };
  const languageOf = (id: string | undefined) => list.find((course) => course.id === id)?.language;
  const course = list.find((item) => item.id === oldChosen?.value);
  const shown = course && (course.started || oldStarted || !list.some((item) => item.started));
  return { chosen: shown ? course.language : undefined, started: languageOf(oldStarted?.value) };
});

/**
 * Язык «Слов», «Чтения» и «Прогресса»: выбранный, если уроки его курса на устройстве; иначе последний выбранный
 * такой; иначе язык основного курса. Пока ничего не начато — выбранный язык каталога.
 */
export const currentLanguage = zoned(async function currentLanguage(
  database: AppDatabase = db,
): Promise<Language | undefined> {
  const list = await courses(database);
  const [choice, primary] = await Promise.all([readLanguageChoice(list, database), primaryCourse(database)]);
  const installed = list.filter((course) => course.installed);
  const pool = installed.length ? installed : list;
  return (
    pool.find((course) => course.language === choice.chosen)?.language ??
    installed.find((course) => course.language === choice.started)?.language ??
    list.find((course) => course.id === primary)?.language
  );
});

/** Язык «Курса»: выбранный, в том числе без начатых курсов, иначе язык остальных экранов. */
export const shelfLanguage = zoned(async function shelfLanguage(
  database: AppDatabase = db,
): Promise<Language | undefined> {
  const list = await courses(database);
  const { chosen } = await readLanguageChoice(list, database);
  return list.find((course) => course.language === chosen)?.language ?? currentLanguage(database);
});

const readShelfChoices = zoned(async function readShelfChoices(database: AppDatabase): Promise<Record<string, string>> {
  try {
    const raw = (await database.meta.get(SHELF_COURSE_KEY))?.value;
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
});
const rememberShelfCourse = (course: { id: string; language: Language }, database: AppDatabase) =>
  database.transaction("rw", database.meta, async () =>
    database.meta.put({
      key: SHELF_COURSE_KEY,
      value: JSON.stringify({ ...(await readShelfChoices(database)), [course.language]: course.id }),
    }),
  );

/**
 * Курс «Курса»: выбранный в языке «Курса»; иначе основной курс устройства, если он этого языка, иначе первый курс языка;
 * из начатых предпочтён установленный: курс, ждущий установки из снимка, показать нечем.
 */
export const shelfCourse = zoned(async function shelfCourse(database: AppDatabase = db): Promise<string | undefined> {
  const [language, list, primary, choices] = await Promise.all([
    shelfLanguage(database),
    courses(database),
    primaryCourse(database),
    readShelfChoices(database),
  ]);
  const own = list.filter((course) => course.language === language);
  const started = own.filter((course) => course.started);
  const chosen = choices[language ?? ""];
  if ((await upcomingCourses(database)).some((course) => course.id === chosen && course.language === language))
    return chosen;
  return (
    own.find((course) => course.id === chosen) ??
    started.find((course) => course.id === primary && course.installed) ??
    started.find((course) => course.installed) ??
    started[0] ??
    own[0]
  )?.id;
});

export async function chooseShelfCourse(courseId: string, database: AppDatabase = db): Promise<void> {
  const course =
    (await courses(database)).find((item) => item.id === courseId) ??
    (await upcomingCourses(database)).find((item) => item.id === courseId);
  if (!course) return;
  await rememberShelfCourse(course, database);
  if ((await shelfLanguage(database)) !== course.language) await setCurrentLanguage(course.language, database);
}

/**
 * Язык без начатых курсов выбирают только на «Курсе»; прежде чем выбор уйдёт на него, начатый выбор запоминается
 * отдельно — его показывают «Слова», «Чтение» и «Прогресс».
 */
export async function setCurrentLanguage(code: Language, database: AppDatabase = db): Promise<void> {
  const list = await courses(database);
  const { chosen, started } = await readLanguageChoice(list, database);
  const installed = (language: string | undefined) =>
    list.some((course) => course.language === language && course.installed);
  const remember = installed(code) ? code : installed(chosen) ? chosen! : (started ?? "");
  await database.meta.bulkPut([
    { key: CURRENT_STARTED_LANGUAGE_KEY, value: remember },
    { key: CURRENT_LANGUAGE_KEY, value: code },
  ]);
}

/** Курс карточки — курс урока, в котором она стоит: сборка не пускает карточку в уроки двух курсов. */
export const courseOfCards = zoned(async function courseOfCards(
  unitKeys: string[],
  database: AppDatabase = db,
): Promise<Map<string, string>> {
  if (!unitKeys.length) return new Map();
  const result = new Map<string, string>();
  const items = await database.lessonItems.where("unitKey").anyOf(unitKeys).toArray();
  const byLesson = await lessonCourses(
    items.map((item) => item.lessonId),
    database,
  );
  for (const item of items) {
    const course = byLesson.get(item.lessonId);
    if (course && !result.has(item.unitKey)) result.set(item.unitKey, course);
  }
  return result;
});
/** Курс карточек; карточка вне уроков (связь снята обновлением) — у домашнего курса: так её повторение не теряется. */
export const cardCourses = zoned(async function cardCourses(
  unitKeys: string[],
  database: AppDatabase = db,
): Promise<Map<string, string>> {
  const owners = await courseOfCards(unitKeys, database);
  const home = unitKeys.some((key) => !owners.has(key)) ? await homeCourse(database) : undefined;
  if (home) for (const key of unitKeys) if (!owners.has(key)) owners.set(key, home);
  return owners;
});
export const courseOfCard = zoned(async (unitKey: string, database: AppDatabase = db) =>
  (await cardCourses([unitKey], database)).get(unitKey),
);

export const cardsInCourse = zoned(async function cardsInCourse(
  unitKeys: string[],
  courseId: string | string[],
  database: AppDatabase = db,
): Promise<Set<string>> {
  const owners = await cardCourses(unitKeys, database);
  const wanted = new Set(typeof courseId === "string" ? [courseId] : courseId);
  return new Set(unitKeys.filter((key) => wanted.has(owners.get(key) ?? "")));
});

export const cardLanguages = zoned(async function cardLanguages(
  refs: LearningRef[],
  database: AppDatabase = db,
): Promise<Map<string, Language>> {
  const keys = refs.map(unitKey);
  const owners = await cardCourses(keys, database);
  const languages = new Map(
    await Promise.all(
      [...new Set(owners.values())].map(async (id) => [id, await courseLanguage(id, database)] as const),
    ),
  );
  return new Map(keys.map((key) => [key, languages.get(owners.get(key) ?? "") ?? DEFAULT_LANGUAGE]));
});

/** Чтения уроков и связей целиком; источник плана берёт их один раз на всё построение, а не на каждый курс. */
export interface LessonReads {
  lessons(): Promise<Lesson[]>;
  items(): Promise<LessonItem[]>;
}
export const tableReads = (database: AppDatabase): LessonReads => ({
  lessons: () => database.lessons.toArray(),
  items: () => database.lessonItems.toArray(),
});
export function sharedReads(database: AppDatabase): LessonReads {
  let lessons: Promise<Lesson[]> | undefined;
  let items: Promise<LessonItem[]> | undefined;
  return {
    lessons: () => (lessons ??= database.lessons.toArray()),
    items: () => (items ??= database.lessonItems.toArray()),
  };
}

/** Уроки курса на устройстве; урок без курса (старый профиль) — у домашнего курса. */
export const courseLessonIds = zoned(async function courseLessonIds(
  courseId: string,
  database: AppDatabase = db,
  reads: LessonReads = tableReads(database),
): Promise<string[]> {
  const lessons = await reads.lessons();
  const owners = await lessonCourses(
    lessons.filter((lesson) => !lesson.courseId).map((lesson) => lesson.id),
    database,
  );
  const ownerOf = (id: string, own?: string) => own ?? owners.get(id);
  const home = lessons.some((lesson) => !ownerOf(lesson.id, lesson.courseId)) ? await homeCourse(database) : undefined;
  return lessons
    .filter((lesson) => (ownerOf(lesson.id, lesson.courseId) ?? home) === courseId)
    .map((lesson) => lesson.id);
});

/** `anyOf("lessonId")` идёт курсором по шагу на строку: на курсе из сотни уроков это секунды, `toArray` — миллисекунды. */
export const lessonItemsOf = zoned(async function lessonItemsOf(
  lessonIds: string[],
  database: AppDatabase = db,
  reads: LessonReads = tableReads(database),
): Promise<LessonItem[]> {
  if (!lessonIds.length) return [];
  const wanted = new Set(lessonIds);
  return (await reads.items()).filter((item) => wanted.has(item.lessonId));
});

/** Идентификаторы карточек вида в уроках курса, по порядку id. */
export const courseCardIds = zoned(async function courseCardIds(
  courseId: string,
  kind: CardKind,
  database: AppDatabase = db,
  reads: LessonReads = tableReads(database),
): Promise<string[]> {
  const lessonIds = await courseLessonIds(courseId, database, reads);
  if (!lessonIds.length) return [];
  const items = await lessonItemsOf(lessonIds, database, reads);
  return [...new Set(items.filter((item) => item.ref.kind === kind).map((item) => item.ref.id))].sort();
});

/** Курс занятия; занятие прежней версии без курса — занятие домашнего курса. */
export const sessionCourse = zoned(
  async (session: Pick<Session, "courseId">, database: AppDatabase = db) => session.courseId ?? homeCourse(database),
);

/** Язык занятия: записанный новой версией, иначе язык его курса; занятие без курса — домашнего курса. */
export const sessionLanguage = zoned(async function sessionLanguage(
  session: Pick<Session, "courseId" | "language">,
  database: AppDatabase = db,
): Promise<Language> {
  if (session.language) return session.language;
  const courseId = await sessionCourse(session, database);
  return courseId ? courseLanguage(courseId, database) : DEFAULT_LANGUAGE;
});
const isPracticeSession = (session: Session) => session.items.every((item) => item.mode === "practice");

/**
 * Какие незавершённые занятия предлагаются: тренировка — всегда; прежнее занятие повторения курса на паузе ждёт
 * возврата курса; занятие новой версии — пока у его языка есть начатый курс не на паузе.
 */
const offeredSessions = zoned(async function offeredSessions(
  database: AppDatabase,
): Promise<{ session: Session; language: Language }[]> {
  const active = await database.sessions
    .where("[status+createdAt]")
    .between(["active", Dexie.minKey], ["active", Dexie.maxKey])
    .reverse()
    .toArray();
  if (!active.length) return [];
  const [list, home] = await Promise.all([courses(database), homeCourse(database)]);
  const byId = new Map(list.map((course) => [course.id, course]));
  const going = new Set(list.filter((course) => course.started && !course.pausedAt).map((course) => course.language));
  const shown = new Set(list.map((course) => course.language));
  return active.flatMap((session) => {
    const course = byId.get(session.courseId ?? home ?? "");
    const language = session.language ?? course?.language ?? DEFAULT_LANGUAGE;
    const owner = session.courseId ?? home;
    if (list.length && ((!session.language && owner && !byId.has(owner)) || !shown.has(language))) return [];
    const waits = !isPracticeSession(session) && (session.language ? !going.has(language) : !!course?.pausedAt);
    return waits ? [] : [{ session, language }];
  });
});

/** Незавершённое занятие языка, последнее по времени, в том числе тренировка курса. */
export const languageSession = zoned(
  async (language: Language, database: AppDatabase = db): Promise<Session | null> =>
    (await offeredSessions(database)).find((entry) => entry.language === language)?.session ?? null,
);

/**
 * Курсы «Повторить ошибки»: все начатые курсы языка занятия, в том числе на паузе, курс занятия первым. Так курс,
 * поставленный на паузу посреди занятия, сохраняет свои варианты, а занятие получает язык и курс.
 */
export const languageCourses = zoned(async function languageCourses(
  session: Pick<Session, "courseId" | "language">,
  database: AppDatabase = db,
): Promise<string[]> {
  const [language, own, list] = await Promise.all([
    sessionLanguage(session, database),
    sessionCourse(session, database),
    courses(database),
  ]);
  const started = list.filter((course) => course.started && course.language === language).map((course) => course.id);
  return own && started.includes(own) ? [own, ...started.filter((id) => id !== own)] : started;
});

/** Последнее незавершённое занятие любого языка: к нему ведёт «На главную» с адреса без занятия. */
export const anyActiveSession = zoned(
  async (database: AppDatabase = db): Promise<Session | null> => (await offeredSessions(database))[0]?.session ?? null,
);
