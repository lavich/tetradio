import type { ExerciseBlock, ExerciseItem } from "../../content/course";
import type { ContentFetcher } from "../../content/fetcher";
import { parseCatalog, parsePackage, type Catalog } from "../../content/schema";

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

export function pickSample(blocks: readonly { type: string; id: string }[]): SampleTask[] {
  const exercises = new Map(
    blocks.filter((block): block is ExerciseBlock => block.type === "exercise").map((block) => [block.id, block]),
  );
  return PICKS.flatMap(([blockId, itemId]) => {
    const block = exercises.get(blockId);
    const item = block?.items.find((candidate) => candidate.id === itemId);
    return block && item ? [{ block, item }] : [];
  });
}

export interface LandingContent {
  catalog: Catalog;
  tasks: SampleTask[];
}

export async function loadLanding(source: ContentFetcher): Promise<LandingContent> {
  const catalog = parseCatalog(await source.json("content/catalog.json"));
  const entry = catalog.lessons.find((lesson) => lesson.id === SAMPLE_LESSON);
  if (!entry) return { catalog, tasks: [] };
  const pack = parsePackage(await source.json(entry.url));
  return { catalog, tasks: pickSample(pack.blocks ?? []) };
}
