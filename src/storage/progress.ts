import type { CourseCalendar } from "../content/course";
import { mondayOf, studyDay } from "../domain/learning";
import { coursePace, skillProgress, type Pace, type SkillProgress } from "../domain/progress";
import type { BlockProgress } from "../domain/types";
import { lessonDays, moduleViews, type ModuleView } from "./course";
import type { Language } from "../domain/language";
import { cardsInCourse, courses, primaryCourse, type CourseEntry } from "./courses";
import { db, type AppDatabase } from "./db";
import { lessonOutlines } from "./outlines";
import { zoned } from "./zone";

export interface CourseProgress {
  views: ModuleView[];
  /** Номер модуля следующего урока; после последнего — номер последнего модуля. */
  current: number;
  pace: Pace;
  calendar: CourseCalendar | undefined;
  passShare: number | undefined;
  skills: SkillProgress[];
  /** Скачаны все уроки курса: иначе доли навыков считаются по скачанным. */
  complete: boolean;
  week: { today: string; monday: string; lessonDays: string[]; reviewDays: string[]; cards: number };
}

const lessonsOf = (view: ModuleView) => [
  ...view.lessons,
  ...(view.checkpoint ? [view.checkpoint] : []),
  ...view.review,
];

/** Прогресс курса: календарь, порог и неделя — этого курса; без курса — основного. */
export const courseProgress = zoned(
  async (now: Date, timezone: string, courseId?: string, database: AppDatabase = db): Promise<CourseProgress> =>
    (await courseData(now, timezone, courseId, database)).progress,
);

export interface LanguageProgress {
  /** Начатые курсы языка по порядку курсов, в том числе на паузе. */
  courses: (CourseProgress & { course: CourseEntry })[];
  /** Сумма по языку: навыки по заданиям всех курсов сразу, а не среднее их долей. */
  total: Pick<CourseProgress, "skills" | "complete" | "week">;
}

export const languageProgress = zoned(async function languageProgress(
  now: Date,
  timezone: string,
  language: Language | undefined,
  database: AppDatabase = db,
): Promise<LanguageProgress> {
  const own = (await courses(database)).filter((course) => course.language === language && course.started);
  const data = await Promise.all(own.map((course) => courseData(now, timezone, course.id, database)));
  const today = studyDay(now, timezone);
  const events = data.flatMap((item) => item.scheduled);
  return {
    courses: data.map((item, index) => ({ ...item.progress, course: own[index] })),
    total: {
      skills: skillProgress(data.flatMap((item) => item.inputs)),
      complete: data.every((item) => item.progress.complete),
      week: {
        today,
        monday: mondayOf(today),
        lessonDays: [...new Set(data.flatMap((item) => item.progress.week.lessonDays))].sort(),
        reviewDays: [...new Set(events.map((event) => event.localDate))].sort(),
        cards: new Set(events.map((event) => event.unitKey)).size,
      },
    },
  };
});

const courseData = zoned(async function courseData(
  now: Date,
  timezone: string,
  courseId: string | undefined,
  database: AppDatabase,
) {
  const today = studyDay(now, timezone);
  const monday = mondayOf(today);
  courseId ??= await primaryCourse(database);
  const views = await moduleViews(courseId, database);
  const course = courseId ? await database.courses.get(courseId) : undefined;
  const ids = views.flatMap((view) => lessonsOf(view).map((lesson) => lesson.id));
  const [outlines, lessons, rows] = await Promise.all([
    lessonOutlines(ids, database),
    database.lessons.bulkGet(ids),
    database.blockProgress.where("lessonId").anyOf(ids).toArray(),
  ]);
  const progress = new Map<string, Map<string, BlockProgress>>();
  for (const row of rows) {
    const map = progress.get(row.lessonId) ?? new Map();
    map.set(row.blockId, row);
    progress.set(row.lessonId, map);
  }

  const inputs = ids.flatMap((id, index) => {
    const outline = outlines[index];
    return outline?.course
      ? [{ tasks: outline.skills, progress: progress.get(id) ?? new Map<string, BlockProgress>() }]
      : [];
  });
  const skills = skillProgress(inputs);
  // Курс докачивается фоном: пока скачано не всё, доля считается по скачанным урокам.
  const installed = outlines.filter((outline) => outline?.course).length;

  const completedDays = lessons
    .filter((lesson) => lesson?.completed)
    .map((lesson) => studyDay(new Date(lesson!.updatedAt), timezone));
  const pace = coursePace(
    views.map((view) => ({
      number: view.module.number,
      lessons: lessonsOf(view).length || view.module.sessions,
      done: lessonsOf(view).filter((lesson) => lesson.completed).length,
    })),
    today,
    completedDays,
    course?.calendar,
  );
  const next = views.find((view) => lessonsOf(view).some((lesson) => !lesson.completed));
  const events = await database.events.where("localDate").between(monday, today, true, true).toArray();
  const planned = events.filter((event) => event.mode !== "practice");
  const own = courseId
    ? await cardsInCourse([...new Set(planned.map((event) => event.unitKey))], courseId, database)
    : undefined;
  const scheduled = own ? planned.filter((event) => own.has(event.unitKey)) : planned;
  const progressOf: CourseProgress = {
    views,
    current: next?.module.number ?? views.at(-1)?.module.number ?? 1,
    pace,
    calendar: course?.calendar,
    passShare: course?.passShare,
    skills,
    complete: installed === ids.length,
    week: {
      today,
      monday,
      lessonDays: await lessonDays(monday, timezone, courseId, database),
      reviewDays: [...new Set(scheduled.map((event) => event.localDate))],
      cards: new Set(scheduled.map((event) => event.unitKey)).size,
    },
  };
  return { progress: progressOf, inputs, scheduled };
});
