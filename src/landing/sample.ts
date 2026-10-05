import type { CatalogModule, CourseExam, ExerciseBlock, ExerciseItem } from "../content/course";
import { parseCatalog, parsePackage } from "../content/schema";

export const SAMPLE_LESSON = "m01-1";
const PICKS: readonly [block: string, item: string][] = [
  ["read-vowels", "q1"],
  ["write-stress", "q4"],
  ["read-stress", "q3"],
  ["write-stress", "q2"],
];

export interface SampleTask {
  block: ExerciseBlock;
  item: ExerciseItem;
}

/** Задания, выбранные для лендинга; если урок изменился и их нет — первые задания на выбор и на письмо. */
export function pickSample(blocks: readonly { type: string; id: string }[]): SampleTask[] {
  const exercises = blocks.filter((block): block is ExerciseBlock => block.type === "exercise");
  const byId = new Map(exercises.map((block) => [block.id, block]));
  const picked = PICKS.flatMap(([blockId, itemId]) => {
    const block = byId.get(blockId);
    const item = block?.items.find((candidate) => candidate.id === itemId);
    return block && item ? [{ block, item }] : [];
  });
  if (picked.length === PICKS.length) return picked;
  const of = (format: ExerciseBlock["format"]) =>
    exercises
      .filter((block) => block.format === format)
      .flatMap((block) => block.items.map((item) => ({ block, item })));
  const choice = of("choice"),
    text = of("text");
  return [choice[0], text[0], choice[1], text[1]].filter((task): task is SampleTask => !!task);
}

export interface LandingData {
  modules: CatalogModule[];
  exam: CourseExam | null;
  tasks: SampleTask[];
}

/** Данные лендинга из собранного контента: `read` отдаёт файл по пути из каталога или `null`. */
export function loadLandingData(read: (url: string) => string | null): LandingData {
  const raw = read("content/catalog.json");
  if (!raw) return { modules: [], exam: null, tasks: [] };
  const catalog = parseCatalog(JSON.parse(raw));
  const course = catalog.courses[0];
  const modules = (catalog.modules ?? [])
    .filter((module) => !course || module.courseId === course.id)
    .sort((a, b) => a.number - b.number);
  const entry = catalog.lessons.find((lesson) => lesson.id === SAMPLE_LESSON) ?? catalog.lessons[0];
  const pack = entry && read(entry.url);
  return {
    modules,
    exam: course?.exam ?? null,
    tasks: pack ? pickSample(parsePackage(JSON.parse(pack)).blocks ?? []) : [],
  };
}
