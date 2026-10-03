import { SKILLS, type Skill } from "../content/course";
import { testResult } from "../domain/course";
import { addDays, localDay } from "../domain/learning";
import { coursePace, type Pace, type SkillReadiness } from "../domain/progress";
import type { BlockProgress } from "../domain/types";
import { lessonDays, moduleViews, type ModuleView } from "./course";
import { db, type AppDatabase } from "./db";

export interface CourseProgress {
  views: ModuleView[];
  /** Номер модуля следующего урока; после последнего — номер последнего модуля. */
  current: number;
  pace: Pace;
  readiness: SkillReadiness[];
  week: { today: string; monday: string; lessonDays: string[]; reviewDays: string[]; cards: number };
}

const lessonsOf = (view: ModuleView) => [
  ...view.lessons,
  ...(view.checkpoint ? [view.checkpoint] : []),
  ...view.review,
];

export async function courseProgress(now: Date, timezone: string, database: AppDatabase = db): Promise<CourseProgress> {
  const today = localDay(now, timezone);
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const views = await moduleViews(undefined, database);
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

  // Последний по программе результат контрольной по каждому навыку; письмо и речь — накопленная самопроверка.
  const tests = new Map<Skill, SkillReadiness>();
  const self = new Map<Skill, { checked: number; criteria: number; tasks: number }>();
  ids.forEach((id, index) => {
    const pack = packs[index];
    const blocks = pack?.blocks ?? [];
    if (!pack) return;
    const marks = progress.get(id) ?? new Map<string, BlockProgress>();
    if (pack.kind === "test" && lessons[index]?.status === "completed")
      for (const result of testResult(blocks, marks).skills)
        tests.set(result.skill, {
          skill: result.skill,
          share: result.share,
          source: "test",
          basis: lessons[index]?.title ?? id,
        });
    for (const block of blocks) {
      if (block.type !== "writing" && block.type !== "speaking") continue;
      const mark = marks.get(block.id);
      if (!mark?.done) continue;
      const skill: Skill = block.type;
      const entry = self.get(skill) ?? { checked: 0, criteria: 0, tasks: 0 };
      entry.checked += mark.checks?.length ?? 0;
      entry.criteria += block.criteria.length;
      entry.tasks++;
      self.set(skill, entry);
    }
  });
  const readiness = SKILLS.flatMap((skill): SkillReadiness[] => {
    const own = self.get(skill);
    if (tests.has(skill)) return [tests.get(skill)!];
    if (own?.criteria) return [{ skill, share: own.checked / own.criteria, source: "self", basis: String(own.tasks) }];
    return [];
  });

  const completedDays = lessons
    .filter((lesson) => lesson?.status === "completed")
    .map((lesson) => localDay(new Date(lesson!.updatedAt), timezone));
  const pace = coursePace(
    views.map((view) => ({
      number: view.module.number,
      lessons: lessonsOf(view).length || view.module.sessions,
      done: lessonsOf(view).filter((lesson) => lesson.completed).length,
    })),
    today,
    completedDays,
  );
  const next = views.find((view) => lessonsOf(view).some((lesson) => !lesson.completed));
  const events = await database.events.where("localDate").between(monday, today, true, true).toArray();
  const scheduled = events.filter((event) => event.mode !== "practice");
  return {
    views,
    current: next?.module.number ?? views.at(-1)?.module.number ?? 1,
    pace,
    readiness,
    week: {
      today,
      monday,
      lessonDays: await lessonDays(monday, timezone, database),
      reviewDays: [...new Set(scheduled.map((event) => event.localDate))],
      cards: new Set(scheduled.map((event) => event.unitKey)).size,
    },
  };
}
