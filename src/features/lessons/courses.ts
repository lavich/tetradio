import type { CatalogEntry } from "../../content/schema";
import type { Course } from "../../domain/types";
import type { LessonView } from "../../storage/queries";

/** Группа списка уроков: курс из поставки, локальные наборы или уроки, чей курс ещё не известен. */
export interface CourseGroup {
  id: string;
  title: string;
  source?: string;
  origin: "content" | "local" | "unknown";
  subscribed: boolean;
  lessons: LessonView[];
  available: CatalogEntry[];
  /** Курс целиком: у группы «без курса» его нет, настраивать там нечего. */
  course?: Course;
}
export const UNKNOWN_COURSE = "unknown";

/**
 * Ближайшее занятие каждого курса: первый непроведённый урок, подготовка к которому ещё не окончена.
 * Рубеж приходит готовым и у каждого курса свой, как и расписание; урок без даты ближайшим быть не может.
 */
export function nextLessonIds(lessons: LessonView[], prepared: (courseId?: string) => string): Set<string> {
  const soonest = new Map<string, LessonView>();
  for (const lesson of lessons) {
    if (lesson.status === "completed" || !lesson.targetDate || lesson.targetDate <= prepared(lesson.courseId)) continue;
    const key = lesson.courseId ?? UNKNOWN_COURSE;
    const kept = soonest.get(key);
    if (
      !kept ||
      lesson.targetDate < kept.targetDate! ||
      (lesson.targetDate === kept.targetDate && lesson.createdAt < kept.createdAt)
    )
      soonest.set(key, lesson);
  }
  return new Set([...soonest.values()].map((lesson) => lesson.id));
}

/**
 * Порядок групп: подписанные курсы поставки, затем доступные, затем уроки без известного курса
 * и локальные наборы последними. Пустая группа не показывается.
 */
export function groupByCourse(courses: Course[], lessons: LessonView[], entries: CatalogEntry[]): CourseGroup[] {
  const known = new Set(courses.map((course) => course.id));
  const installed = new Set(lessons.map((lesson) => lesson.id));
  const make = (course: Course): CourseGroup => {
    const own = lessons.filter((lesson) => lesson.courseId === course.id);
    const group: CourseGroup = {
      id: course.id,
      title: course.title,
      origin: course.origin,
      subscribed: course.subscribed,
      lessons: own,
      available: entries.filter((entry) => entry.courseId === course.id && !installed.has(entry.id)),
      course,
    };
    if (course.source) group.source = course.source;
    return group;
  };
  const order = (a: Course, b: Course) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const content = courses.filter((course) => course.origin === "content");
  const orphans = lessons.filter((lesson) => !lesson.courseId || !known.has(lesson.courseId));
  const groups = [
    ...content
      .filter((course) => course.subscribed)
      .sort(order)
      .map(make),
    ...content
      .filter((course) => !course.subscribed)
      .sort(order)
      .map(make),
    ...(orphans.length
      ? [
          {
            id: UNKNOWN_COURSE,
            title: "Курс не определён",
            origin: "unknown" as const,
            subscribed: false,
            lessons: orphans,
            available: [],
          },
        ]
      : []),
    ...courses
      .filter((course) => course.origin === "local")
      .sort(order)
      .map(make),
  ];
  return groups.filter((group) => group.lessons.length || group.available.length);
}
