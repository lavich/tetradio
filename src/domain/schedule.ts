import { addDays, preparedThrough } from "./learning";
import {
  DEFAULT_LESSON_HOUR,
  defaultSchedule,
  fillSchedule,
  LOCAL_COURSE,
  type Course,
  type Lesson,
  type Schedule,
} from "./types";

const numberOf = (title: string) =>
  title
    .match(/\d+(?:\.\d+)*/)?.[0]
    .split(".")
    .map(Number);
/** «1.9» < «1.10» < «2.1»; уроки без номера идут после, по дате создания, затем по id. */
export function lessonOrder(a: Lesson, b: Lesson): number {
  const na = numberOf(a.title),
    nb = numberOf(b.title);
  if (na && nb) {
    for (let i = 0; i < Math.min(na.length, nb.length); i++) if (na[i] !== nb[i]) return na[i] - nb[i];
    if (na.length !== nb.length) return na.length - nb.length;
  } else if (na || nb) return na ? -1 : 1;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Порядок показа в списках: сначала наборы с датой по возрастанию, затем без даты по времени создания.
 * Это не порядок расписания — даты назначает `lessonOrder` по номерам в названии; два правила лежат
 * рядом, чтобы не разъехались.
 */
export const byTargetDate = (
  a: { targetDate: string | null; createdAt: string },
  b: { targetDate: string | null; createdAt: string },
): number =>
  Number(!!b.targetDate) - Number(!!a.targetDate) ||
  (a.targetDate ?? "").localeCompare(b.targetDate ?? "") ||
  a.createdAt.localeCompare(b.createdAt);

/** Урок без известного курса живёт по часу по умолчанию. */
export function preparedByCourse(courses: Course[], now: Date, timezone: string): (courseId?: string) => string {
  const byId = new Map(
    courses.map((course) => [course.id, preparedThrough(now, timezone, fillSchedule(course.schedule).lessonHour)]),
  );
  const fallback = preparedThrough(now, timezone, DEFAULT_LESSON_HOUR);
  return (courseId?: string) => byId.get(courseId ?? LOCAL_COURSE) ?? fallback;
}

export const isoWeekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
export const scheduleSet = (schedule: Schedule) => !!schedule.startDate && schedule.weekdays.length > 0;
/** Ближайший день расписания начиная с `day` — включительно или строго после него. */
export function nextLessonDay(day: string, weekdays: number[], inclusive: boolean): string {
  let cursor = inclusive ? day : addDays(day, 1);
  for (let step = 0; step < 7 && !weekdays.includes(isoWeekday(cursor)); step++) cursor = addDays(cursor, 1);
  return cursor;
}

/** Копии уроков с датами по расписанию в исходном порядке массива; исходные объекты не меняются. Дата первого занятия — день первого урока по порядку, проведённые не исключение. */
export function scheduleLessons(lessons: Lesson[], schedule: Schedule): Lesson[] {
  const { weekdays } = schedule;
  let cursor = scheduleSet(schedule) ? nextLessonDay(schedule.startDate!, weekdays, true) : null;
  const dated = new Map<string, Lesson>();
  for (const lesson of [...lessons].sort(lessonOrder)) {
    if (lesson.targetDate) {
      dated.set(lesson.id, { ...lesson, dateSource: "manual" });
      if (cursor) {
        const after = nextLessonDay(lesson.targetDate, weekdays, false);
        if (after > cursor) cursor = after;
      }
    } else if (!cursor) {
      dated.set(lesson.id, { ...lesson });
    } else {
      dated.set(lesson.id, { ...lesson, targetDate: cursor, dateSource: "schedule" });
      cursor = nextLessonDay(cursor, weekdays, false);
    }
  }
  return lessons.map((lesson) => dated.get(lesson.id)!);
}

/** Каждый курс раскладывает только свои уроки и по своему расписанию; порядок массива сохраняется. */
export function scheduleCourses(lessons: Lesson[], courses: Course[]): Lesson[] {
  const scheduleOf = new Map(courses.map((course) => [course.id, course.schedule]));
  const groups = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const key = lesson.courseId ?? LOCAL_COURSE;
    const group = groups.get(key);
    if (group) group.push(lesson);
    else groups.set(key, [lesson]);
  }
  const dated = new Map<string, Lesson>();
  for (const [courseId, group] of groups)
    for (const lesson of scheduleLessons(group, scheduleOf.get(courseId) ?? defaultSchedule))
      dated.set(lesson.id, lesson);
  return lessons.map((lesson) => dated.get(lesson.id)!);
}
