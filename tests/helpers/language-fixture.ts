import { createEmptyCard, State } from "ts-fsrs";
import type { Language } from "../../src/domain/language";
import type { PlanPause } from "../../src/domain/plan";
import type { Course, LearningState, Lesson, MistakeItem, Phrase, Word } from "../../src/domain/types";
import { unitKey, wordKeyOf, wordRef } from "./cards";
import type { Snapshot } from "./snapshot-source";

/** Два английских курса и греческий в одном снимке: «it» и «travel» — английские, «greek» — домашний. */
export const NOW = new Date("2026-09-15T09:00:00Z");
const iso = NOW.toISOString();
export const LANGUAGES: Record<string, Language> = { greek: "el", it: "en", travel: "en" };
const PREFIX: Record<string, string> = { greek: "g", it: "i", travel: "t" };

export const wordOf = (courseId: string, index: number): Word => ({
  id: `${PREFIX[courseId]}${index}`,
  greek: LANGUAGES[courseId] === "el" ? `το λέξη${PREFIX[courseId]}${index}` : `the ${courseId}word${index}`,
  russian: `${courseId}-слово${index}`,
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: iso,
  updatedAt: iso,
});
export const phraseOf = (courseId: string, index: number, translated = true): Phrase => ({
  id: `${PREFIX[courseId]}p${index}`,
  text: `${courseId} phrase ${index}`,
  ...(translated ? { translation: `${courseId}-фраза${index}` } : {}),
  createdAt: iso,
  updatedAt: iso,
});
export const mistakeOf = (courseId: string, index: number): MistakeItem => ({
  id: `${PREFIX[courseId]}l/b/q${index}`,
  lessonId: `${PREFIX[courseId]}l`,
  format: "text",
  instruction: "Впишите",
  prompt: `${courseId} вопрос ${index}`,
  answer: [`${courseId} ответ ${index}`],
});

export const reviewOf = (
  key: Pick<LearningState, "unitKey" | "ref">,
  due: string,
  { state = State.Review, lastReview = "2026-09-01T09:00:00Z", stability = 10 } = {},
): LearningState => ({
  ...key,
  introducedAt: "2026-08-01T09:00:00Z",
  version: 1,
  card: {
    ...createEmptyCard(new Date("2026-08-01")),
    due: new Date(due),
    last_review: new Date(lastReview),
    stability,
    difficulty: 5,
    state,
    scheduled_days: 3,
    reps: 3,
  },
});
export const wordKey = (word: Word) => ({ unitKey: wordKeyOf(word.id), ref: wordRef(word.id) });
export const phraseKey = (phrase: Phrase) => {
  const ref = { kind: "phrase" as const, id: phrase.id };
  return { unitKey: unitKey(ref), ref };
};
export const mistakeKey = (item: MistakeItem) => {
  const ref = { kind: "mistake" as const, id: item.id };
  return { unitKey: unitKey(ref), ref };
};

export interface CourseCards {
  words?: number;
  phrases?: Phrase[];
  mistakes?: MistakeItem[];
  /** Состояния карточек курса по слову: без записи слово новое. */
  states?: (words: Word[]) => LearningState[];
}
/**
 * Снимок: у каждого курса один пройденный урок со своими словами и фразами. Порядок курсов в снимке — `greek`,
 * `it`, `travel`: карточка вне уроков — у греческого, как у домашнего курса.
 */
export function languageSnapshot(
  cards: Partial<Record<"greek" | "it" | "travel", CourseCards>>,
  pauses?: Record<string, PlanPause>,
): Snapshot {
  const ids = ["greek", "it", "travel"] as const;
  const courses: Course[] = ids.map((id) => ({ id, title: id, updatedAt: iso }));
  const lessons: Lesson[] = [];
  const snapshot: Snapshot = {
    words: [],
    phrases: [],
    mistakes: [],
    lessons,
    courses,
    links: [],
    items: [],
    states: [],
    events: [],
    sessions: [],
    languages: LANGUAGES,
    ...(pauses ? { pauses } : {}),
  };
  for (const id of ids) {
    const spec = cards[id];
    if (!spec) continue;
    const lessonId = `${PREFIX[id]}l`;
    lessons.push({ id: lessonId, courseId: id, title: `${id} урок`, completed: true, updatedAt: iso });
    const words = Array.from({ length: spec.words ?? 0 }, (_, index) => wordOf(id, index));
    snapshot.words.push(...words);
    snapshot.links.push(...words.map((word, position) => ({ lessonId, wordId: word.id, position })));
    for (const [index, phrase] of (spec.phrases ?? []).entries()) {
      snapshot.phrases!.push(phrase);
      snapshot.items!.push({ lessonId, ...phraseKey(phrase), position: words.length + index });
    }
    snapshot.mistakes!.push(...(spec.mistakes ?? []));
    snapshot.states.push(...(spec.states?.(words) ?? []));
  }
  return snapshot;
}
