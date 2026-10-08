import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "../domain/types";
import {
  activeSession,
  courses,
  currentCourse,
  primaryCourse,
  setCurrentCourse,
  setPrimaryCourse,
  type CourseEntry,
} from "../storage/courses";

/** Установленные курсы по порядку: основной первый. `undefined` — ещё читается. */
export const useCourses = (): CourseEntry[] | undefined =>
  useLiveQuery(async () => (await courses()).filter((course) => course.installed), []);
/** Все курсы каталога по порядку, с признаком установки. */
export const useAllCourses = (): CourseEntry[] | undefined => useLiveQuery(() => courses(), []);

export const usePrimaryCourse = (): string | undefined => useLiveQuery(() => primaryCourse(), []);
export { setPrimaryCourse };

/** Курс «Курса», «Слов» и «Прогресса» и его смена; выбор общий для трёх экранов и переживает перезапуск. */
export const useCurrentCourse = (): [string | undefined, (courseId: string) => Promise<void>] => [
  useLiveQuery(() => currentCourse(), []),
  setCurrentCourse,
];

/** Незавершённое занятие курса: `undefined` — ещё читается, `null` — нет. */
export const useCourseSession = (courseId: string | undefined): Session | null | undefined =>
  useLiveQuery(() => (courseId ? activeSession(courseId) : null), [courseId]);
