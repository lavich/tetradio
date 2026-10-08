import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { DEFAULT_LANGUAGE, PROFILES, type LanguageProfile } from "../domain/language";
import { unitKey } from "../domain/refs";
import type { LearningRef, Session } from "../domain/types";
import {
  activeSession,
  courseOfCards,
  courses,
  currentCourse,
  primaryCourse,
  profileOfCourse,
  setCurrentCourse,
  setPrimaryCourse,
  type CourseEntry,
} from "../storage/courses";

/** Установленные курсы по порядку: основной первый. `undefined` — ещё читается. */
export const useCourses = (): CourseEntry[] | undefined =>
  useLiveQuery(async () => (await courses()).filter((course) => course.installed), []);
/** Все курсы каталога по порядку, с признаком установки. */
export const useAllCourses = (): CourseEntry[] | undefined => useLiveQuery(() => courses(), []);

/** Основной курс: `null` — курсов в каталоге нет, `undefined` — ещё читается. */
export const usePrimaryCourse = (): string | null | undefined =>
  useLiveQuery(async () => (await primaryCourse()) ?? null, []);
export { setPrimaryCourse };

/** Курс «Курса», «Слов» и «Прогресса» и его смена; выбор общий для трёх экранов и переживает перезапуск. */
export const useCurrentCourse = (): [string | undefined, (courseId: string) => Promise<void>] => [
  useLiveQuery(() => currentCourse(), []),
  setCurrentCourse,
];

/** Незавершённое занятие курса: `undefined` — ещё читается, `null` — нет. */
export const useCourseSession = (courseId: string | undefined): Session | null | undefined =>
  useLiveQuery(() => (courseId ? activeSession(courseId) : null), [courseId]);

/** Модуль, урок или слово другого курса, открытые по ссылке, делают свой курс выбранным. */
export function useFollowCourse(courseId: string | undefined) {
  useEffect(() => {
    if (!courseId) return;
    void currentCourse().then((current) => (current === courseId ? undefined : setCurrentCourse(courseId)));
  }, [courseId]);
}

/** Курс карточки; карточка вне уроков — у основного курса. `null` — курсов нет, `undefined` — ещё читается. */
export function useCardCourse(ref: LearningRef | undefined): string | null | undefined {
  const key = ref && unitKey(ref);
  return useLiveQuery(
    async () => (key ? ((await courseOfCards([key])).get(key) ?? (await primaryCourse()) ?? null) : undefined),
    [key],
  );
}

/** Язык карточки — язык её курса; `undefined` — ещё читается. */
export function useCardProfile(ref: LearningRef | undefined): LanguageProfile | undefined {
  const key = ref && unitKey(ref);
  return useLiveQuery(async () => {
    if (!key) return undefined;
    const courseId = (await courseOfCards([key])).get(key) ?? (await primaryCourse());
    return courseId ? profileOfCourse(courseId) : PROFILES[DEFAULT_LANGUAGE];
  }, [key]);
}
