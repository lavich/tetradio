import type { CourseCalendar } from "../content/course";
import { localDay, mondayOf } from "../domain/learning";
import { coursePace, skillProgress, type Pace, type SkillProgress } from "../domain/progress";
import type { BlockProgress } from "../domain/types";
import { lessonDays, moduleViews, type ModuleView } from "./course";
import { cardsInCourse, primaryCourse } from "./courses";
import { db, type AppDatabase } from "./db";

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
export async function courseProgress(
  now: Date,
  timezone: string,
  courseId?: string,
  database: AppDatabase = db,
): Promise<CourseProgress> {
  const today = localDay(now, timezone);
  const monday = mondayOf(today);
  courseId ??= await primaryCourse(database);
  const views = await moduleViews(courseId, database);
  const course = courseId ? await database.courses.get(courseId) : undefined;
  const ids = views.flatMap((view) => lessonsOf(view).map((lesson) => lesson.id));
  const [packs, lessons, rows] = await Promise.all([
    database.packages.bulkGet(ids),
    database.lessons.bulkGet(ids),
    database.blockProgress.where("lessonId").anyOf(ids).toArray(),
  ]);
  const progress = new Map<string, Map<string, BlockProgress>>();
  for (const row of rows) {
    const map = progress.get(row.lessonId) ?? new Map();
    map.set(row.blockId, row);
    progress.set(row.lessonId, map);
  }

  const skills = skillProgress(
    ids.flatMap((id, index) => {
      const blocks = packs[index]?.blocks;
      return blocks ? [{ blocks, progress: progress.get(id) ?? new Map<string, BlockProgress>() }] : [];
    }),
  );
  // Курс докачивается фоном: пока скачано не всё, доля считается по скачанным урокам.
  const installed = packs.filter((pack) => pack?.blocks).length;

  const completedDays = lessons
    .filter((lesson) => lesson?.completed)
    .map((lesson) => localDay(new Date(lesson!.updatedAt), timezone));
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
  return {
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
}
