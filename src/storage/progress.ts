import type { CourseCalendar } from "../content/course";
import { mondayOf, studyDay } from "../domain/learning";
import { coursePace, skillProgress, type Pace, type SkillProgress } from "../domain/progress";
import { isReviewDay, readReviewDays, type ReviewDays } from "../domain/review-days";
import type { BlockProgress } from "../domain/types";
import { READING_PREFIX } from "../content/schema";
import { moduleViews, type ModuleView } from "./course";
import type { Language } from "../domain/language";
import { cardCourses, courses, lessonCourses, primaryCourse, type CourseEntry } from "./courses";
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
  /** Все дни уроков и плановых повторений до сегодня, по порядку. */
  days: { lessons: string[]; reviews: string[] };
}

const lessonsOf = (view: ModuleView) => [
  ...view.lessons,
  ...(view.checkpoint ? [view.checkpoint] : []),
  ...view.review,
];

/** Прогресс курса: календарь, порог и неделя — этого курса; без курса — основного. */
export const courseProgress = zoned(
  async (now: Date, timezone: string, courseId?: string, database: AppDatabase = db): Promise<CourseProgress> =>
    (await courseData(now, timezone, courseId, await history(now, timezone, database), database)).progress,
);

interface Review {
  localDate: string;
  unitKey: string;
}

/** Вся история ответов и уроков читается один раз на экран, а не на каждый курс: таблица ответов общая на все языки. */
interface History {
  reviews: Review[];
  /** Дни повторений базы: из облака и свёрнутые при публикациях события этого устройства. */
  synced: ReviewDays;
  cardOwner: Map<string, string>;
  lessons: { day: string; course?: string }[];
}

const history = zoned(async function history(now: Date, timezone: string, database: AppDatabase): Promise<History> {
  const today = studyDay(now, timezone);
  const reviews: Review[] = [];
  await database.events
    .where("localDate")
    .belowOrEqual(today)
    .each((event) => {
      if (isReviewDay(event)) reviews.push({ localDate: event.localDate, unitKey: event.unitKey });
    });
  const rows: { lessonId: string; day: string }[] = [];
  // Чтение днём занятий не считается: отметка «прочитано» — строка блока текста.
  await database.blockProgress.each((row) => {
    if (row.done && !row.lessonId.startsWith(READING_PREFIX))
      rows.push({ lessonId: row.lessonId, day: studyDay(new Date(row.updatedAt), timezone) });
  });
  const [cardOwner, lessonOwner] = await Promise.all([
    cardCourses([...new Set(reviews.map((review) => review.unitKey))], database),
    lessonCourses(
      rows.map((row) => row.lessonId),
      database,
    ),
  ]);
  const synced = readReviewDays((await database.baseSummary.get("base"))?.reviewDays);
  return {
    reviews,
    synced,
    cardOwner,
    lessons: rows.map((row) => ({ day: row.day, course: lessonOwner.get(row.lessonId) })),
  };
});

export interface LanguageProgress {
  /** Начатые курсы языка по порядку курсов, в том числе на паузе. */
  courses: (CourseProgress & { course: CourseEntry })[];
  /** Сумма по языку: навыки по заданиям всех курсов сразу, а не среднее их долей. */
  total: Pick<CourseProgress, "skills" | "complete" | "week" | "days">;
}

export const languageProgress = zoned(async function languageProgress(
  now: Date,
  timezone: string,
  language: Language | undefined,
  database: AppDatabase = db,
): Promise<LanguageProgress> {
  const own = (await courses(database)).filter((course) => course.language === language && course.started);
  const past = await history(now, timezone, database);
  const data = await Promise.all(own.map((course) => courseData(now, timezone, course.id, past, database)));
  const today = studyDay(now, timezone);
  const events = data.flatMap((item) => item.scheduled);
  const week = events.filter((event) => event.localDate >= mondayOf(today));
  const union = (lists: string[][]) => [...new Set(lists.flat())].sort();
  return {
    courses: data.map((item, index) => ({ ...item.progress, course: own[index] })),
    total: {
      skills: skillProgress(data.flatMap((item) => item.inputs)),
      complete: data.every((item) => item.progress.complete),
      week: {
        today,
        monday: mondayOf(today),
        lessonDays: [...new Set(data.flatMap((item) => item.progress.week.lessonDays))].sort(),
        reviewDays: union(data.map((item) => item.progress.week.reviewDays)),
        cards: new Set(week.map((event) => event.unitKey)).size,
      },
      days: {
        lessons: union(data.map((item) => item.progress.days.lessons)),
        reviews: union(data.map((item) => item.progress.days.reviews)),
      },
    },
  };
});

const courseData = zoned(async function courseData(
  now: Date,
  timezone: string,
  courseId: string | undefined,
  past: History,
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
  const scheduled = courseId
    ? past.reviews.filter((review) => past.cardOwner.get(review.unitKey) === courseId)
    : past.reviews;
  const thisWeek = scheduled.filter((event) => event.localDate >= monday);
  const synced = courseId ? past.synced[courseId] : Object.values(past.synced).flat();
  const reviewDays = [
    ...new Set([...scheduled.map((event) => event.localDate), ...(synced ?? []).filter((day) => day <= today)]),
  ].sort();
  const lessonsAll = [
    ...new Set(past.lessons.filter((lesson) => !courseId || lesson.course === courseId).map((lesson) => lesson.day)),
  ].sort();
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
      lessonDays: lessonsAll.filter((day) => day >= monday),
      reviewDays: reviewDays.filter((day) => day >= monday),
      cards: new Set(thisWeek.map((event) => event.unitKey)).size,
    },
    days: { lessons: lessonsAll, reviews: reviewDays },
  };
  return { progress: progressOf, inputs, scheduled };
});
