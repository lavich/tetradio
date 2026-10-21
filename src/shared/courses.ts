import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { DEFAULT_PALETTE, type PaletteName } from "../content/palettes";
import { DEFAULT_LANGUAGE, PROFILES, type Language, type LanguageProfile } from "../domain/language";
import { unitKey } from "../domain/refs";
import { reportError } from "../reporting/reporting";
import type { LearningRef, Session } from "../domain/types";
import {
  activeSession,
  courseOfCard,
  courses,
  currentLanguage,
  languageSession,
  languages,
  primaryCourse,
  followCourse,
  profileOfCourse,
  setCurrentLanguage,
  setPrimaryCourse,
  shelfLanguage,
  todayCourse,
  type CourseEntry,
  type LanguageEntry,
} from "../storage/courses";
import { todayCourses, todayLanguage } from "../storage/today";

/** Установленные курсы по порядку установки. `undefined` — ещё читается. */
export const useCourses = (): CourseEntry[] | undefined =>
  useLiveQuery(async () => (await courses()).filter((course) => course.installed), []);
/** Начатые курсы, затем неначатые курсы каталога с уроками. */
export const useAllCourses = (): CourseEntry[] | undefined => useLiveQuery(() => courses(), []);

/** Основной курс: `null` — курсов в каталоге нет, `undefined` — ещё читается. */
export const usePrimaryCourse = (): string | null | undefined =>
  useLiveQuery(async () => (await primaryCourse()) ?? null, []);
export { setPrimaryCourse };

/** Курс «Сегодня» — основной или следующий не на паузе: `null` — все начатые курсы на паузе или курсов нет. */
export const useTodayCourse = (): string | null | undefined =>
  useLiveQuery(async () => (await todayCourse()) ?? null, []);
/** Язык «Сегодня»: `null` — все начатые курсы на паузе или курсов нет, `undefined` — ещё читается. */
export const useTodayLanguage = (): Language | null | undefined =>
  useLiveQuery(async () => (await todayLanguage()) ?? null, []);
/** Начатые курсы языка не на паузе, основной курс языка первым. */
export const useTodayCourses = (language: Language | undefined): CourseEntry[] | undefined =>
  useLiveQuery(async () => (language ? todayCourses(language) : []), [language]);
/** Незавершённое занятие языка: `undefined` — ещё читается, `null` — нет. */
export const useLanguageSession = (language: Language | undefined): Session | null | undefined =>
  useLiveQuery(async () => (language ? languageSession(language) : null), [language]);
/** Начатые курсы, в том числе ещё не скачанные. */
export const useStartedCourses = (): CourseEntry[] | undefined =>
  useLiveQuery(async () => (await courses()).filter((course) => course.started), []);

export const useLanguages = (): LanguageEntry[] | undefined => useLiveQuery(() => languages(), []);
/** Язык «Слов», «Чтения» и «Прогресса» и смена выбора; язык без начатых курсов выбирает только «Курс». */
export const useCurrentLanguage = (): [Language | undefined, (code: Language) => Promise<void>] => [
  useLiveQuery(() => currentLanguage(), []),
  setCurrentLanguage,
];
/** Язык «Курса»: бывает и языком без начатых курсов. */
export const useShelfLanguage = (): Language | undefined => useLiveQuery(() => shelfLanguage(), []);
/** Гамма обложек курса; пока читается — гамма по умолчанию, у греческого курса она и есть. */
export function useCoursePalette(courseId: string | undefined): PaletteName {
  return (
    useLiveQuery(
      async () => (await courses()).find((course) => course.id === courseId)?.palette ?? DEFAULT_PALETTE,
      [courseId],
    ) ?? DEFAULT_PALETTE
  );
}

export const courseName = (course: Pick<CourseEntry, "short" | "title" | "level">) =>
  [course.short ?? course.title, course.level].filter(Boolean).join(" · ");

/** Незавершённое занятие курса: `undefined` — ещё читается, `null` — нет. */
export const useCourseSession = (courseId: string | undefined): Session | null | undefined =>
  useLiveQuery(() => (courseId ? activeSession(courseId) : null), [courseId]);

/** Модуль, урок или слово другого курса, открытые по ссылке, делают свой курс выбранным. */
export function useFollowCourse(courseId: string | undefined) {
  useEffect(() => {
    if (!courseId) return;
    void followCourse(courseId).catch((error: unknown) => void reportError(error, { category: "storage" }));
  }, [courseId]);
}

/** Курс карточки. `null` — курсов нет, `undefined` — ещё читается. */
export function useCardCourse(ref: LearningRef | undefined): string | null | undefined {
  const key = ref && unitKey(ref);
  return useLiveQuery(async () => (key ? ((await courseOfCard(key)) ?? null) : undefined), [key]);
}

/** Язык карточки — язык её курса; `undefined` — ещё читается. */
export function useCardProfile(ref: LearningRef | undefined): LanguageProfile | undefined {
  const key = ref && unitKey(ref);
  return useLiveQuery(async () => {
    if (!key) return undefined;
    const courseId = await courseOfCard(key);
    return courseId ? profileOfCourse(courseId) : PROFILES[DEFAULT_LANGUAGE];
  }, [key]);
}
