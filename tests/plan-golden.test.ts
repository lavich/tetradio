import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
import { makePlan, makeSession, type SessionSource } from "../src/domain/learning";
import { fromSnapshot } from "../src/domain/snapshot-source";
import {
  defaultSchedule,
  defaultSettings,
  type Course,
  type ExerciseType,
  type LearningState,
  type Lesson,
  type ReviewEvent,
  type Snapshot,
  type Word,
} from "../src/domain/types";
import { idsOf, wordEvent, wordRef, wordState } from "./helpers/cards";

/**
 * Эталон планировщика: результаты зафиксированы на снимке до перехода на выборочные запросы.
 * Новый доступ к данным обязан выдавать те же очереди, задания и варианты при том же источнике случайности.
 */
const FIXTURE = "tests/fixtures/plan-golden.json";
const now = new Date("2026-09-15T09:00:00Z");
const iso = now.toISOString();

/** Детерминированный генератор: одна и та же последовательность в записи и в проверке. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const word = (index: number, over: Partial<Word> = {}): Word => ({
  id: `w${index}`,
  greek: `το λέξη${index}`,
  russian: `слово${index}`,
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
type LessonSpec = Lesson & { wordIds: string[] };
const lesson = (id: string, wordIds: string[], targetDate: string | null, over: Partial<Lesson> = {}): LessonSpec => ({
  id,
  title: id,
  targetDate,
  status: "upcoming",
  wordIds,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const learned = (id: string, due: string, state = State.Review, introducedAt = "2026-09-01T09:00:00Z"): LearningState =>
  wordState(id, {
    introducedAt,
    version: 1,
    card: { ...createEmptyCard(new Date("2026-09-01")), due: new Date(due), state, scheduled_days: 3, reps: 2 },
  });
const event = (wordId: string, type: ExerciseType, correct: boolean, at: string): ReviewEvent =>
  wordEvent(wordId, {
    id: `${wordId}-${type}-${at}`,
    sessionId: "s",
    itemId: `${wordId}-${type}-${at}`,
    snapshot: { greek: "", russian: "" },
    type,
    mode: "scheduled",
    rating: correct ? 3 : 1,
    correct,
    answer: "",
    createdAt: at,
    localDate: at.slice(0, 10),
    responseTimeMs: 1000,
  });
const base = (over: Partial<Omit<Snapshot, "lessons">> & { lessons?: LessonSpec[] } = {}): Snapshot => ({
  words: [],
  states: [],
  events: [],
  sessions: [],
  settings: defaultSettings,
  // Предел локального курса закреплён: эталон фиксирует поведение, а не значение по умолчанию.
  courses: [
    {
      id: "my",
      title: "Мои слова",
      origin: "local",
      subscribed: true,
      schedule: defaultSchedule,
      newItemsPerDay: 10,
      createdAt: iso,
      updatedAt: iso,
    },
  ],
  ...over,
  lessons: (over.lessons ?? []).map(({ wordIds: _, ...rest }) => rest),
  links: (over.lessons ?? []).flatMap((l) =>
    l.wordIds.map((wordId, position) => ({ lessonId: l.id, wordId, position })),
  ),
});

export const scenarios: Record<string, Snapshot> = {
  mixed: (() => {
    const words = Array.from({ length: 40 }, (_, i) => word(i, i === 5 || i === 7 ? { deletedAt: iso } : {}));
    const ids = words.map((w) => w.id);
    return base({
      words,
      lessons: [
        lesson("l1", ids.slice(0, 20), "2026-09-18"),
        lesson("l2", ids.slice(10, 30), "2026-09-20"),
        lesson("l3", ids.slice(30, 35), null),
        lesson("l4", ids.slice(35, 38), "2026-09-10", { status: "completed" }),
      ],
      states: [
        learned("w20", "2026-09-15T08:00:00Z"),
        learned("w21", "2026-09-12T08:00:00Z"),
        learned("w22", "2026-09-14T08:00:00Z", State.Relearning),
        learned("w23", "2026-09-14T09:00:00Z", State.Learning),
        learned("w24", "2026-09-13T08:00:00Z"),
        learned("w25", "2026-09-16T08:00:00Z"),
        learned("w0", "2026-09-16T08:00:00Z", State.Learning, "2026-09-15T07:00:00Z"),
        learned("w1", "2026-09-16T08:00:00Z", State.Learning, "2026-09-15T07:30:00Z"),
        learned("w3", "2026-09-16T08:00:00Z"),
        learned("w5", "2026-09-14T08:00:00Z"),
      ],
      events: [
        event("w20", "recognition", true, "2026-09-10T09:00:00Z"),
        event("w20", "assembly", true, "2026-09-11T09:00:00Z"),
        event("w20", "assembly", true, "2026-09-12T09:00:00Z"),
        event("w21", "recognition", true, "2026-09-10T09:00:00Z"),
        event("w21", "assembly", true, "2026-09-11T09:00:00Z"),
        event("w21", "assembly", true, "2026-09-12T09:00:00Z"),
        event("w21", "spelling", false, "2026-09-13T09:00:00Z"),
        event("w22", "recognition", false, "2026-09-13T09:00:00Z"),
        event("w22", "recognition", false, "2026-09-14T09:00:00Z"),
        event("w24", "recognition", true, "2026-09-08T09:00:00Z"),
        event("w24", "assembly", true, "2026-09-09T09:00:00Z"),
        event("w24", "spelling", true, "2026-09-10T09:00:00Z"),
        event("w24", "listening", false, "2026-09-11T09:00:00Z"),
      ],
      courses: [
        {
          id: "my",
          title: "Мои слова",
          origin: "local",
          subscribed: true,
          schedule: defaultSchedule,
          newItemsPerDay: 10,
          createdAt: iso,
          updatedAt: iso,
        },
      ],
      settings: { ...defaultSettings, sessionSize: 12 },
    });
  })(),
  budgetExhausted: (() => {
    const words = Array.from({ length: 30 }, (_, i) => word(i));
    const ids = words.map((w) => w.id);
    return base({
      words,
      lessons: [lesson("l1", ids, "2026-09-18")],
      states: ids.slice(0, 10).map((id) => learned(id, "2026-09-16T09:00:00Z", State.Learning, iso)),
    });
  })(),
  noDated: (() => {
    const words = Array.from({ length: 12 }, (_, i) => word(i));
    const ids = words.map((w) => w.id);
    return base({
      words,
      lessons: [lesson("l1", ids.slice(4, 8), null)],
      courses: [
        {
          id: "my",
          title: "Мои слова",
          origin: "local",
          subscribed: true,
          schedule: defaultSchedule,
          newItemsPerDay: 5,
          createdAt: iso,
          updatedAt: iso,
        },
      ],
      settings: { ...defaultSettings, sessionSize: 6 },
    });
  })(),
  smallDict: base({
    words: [word(0), word(1), word(2)],
    states: [learned("w0", "2026-09-14T08:00:00Z")],
    settings: { ...defaultSettings, sessionSize: 4 },
  }),
  twoCourses: (() => {
    const words = Array.from({ length: 40 }, (_, i) => word(i));
    const ids = words.map((w) => w.id);
    const course = (id: string, perDay: number, weekdays: number[]): Course => ({
      id,
      title: id,
      origin: "content",
      subscribed: true,
      schedule: { startDate: "2026-09-15", weekdays, lessonHour: 12 },
      newItemsPerDay: perDay,
      createdAt: iso,
      updatedAt: iso,
    });
    return base({
      words,
      courses: [course("near", 6, [2, 5]), course("far", 3, [6])],
      lessons: [
        lesson("n1", ids.slice(0, 12), "2026-09-16", { courseId: "near" }),
        lesson("n2", ids.slice(12, 20), null, { courseId: "near" }),
        lesson("f1", ids.slice(20, 32), "2026-09-26", { courseId: "far" }),
      ],
      states: [learned("w0", "2026-09-14T08:00:00Z")],
      settings: { ...defaultSettings, sessionSize: 10 },
    });
  })(),
};

const stripSession = (session: Awaited<ReturnType<typeof makeSession>>) => ({
  planDate: session.planDate,
  items: session.items.map((item) => ({
    id: item.id.replace(session.id, "S"),
    wordId: item.ref.id,
    type: item.type,
    options: item.options,
    isNew: item.isNew,
    mode: item.mode,
    expectedVersion: item.expectedVersion,
  })),
});
const stripPlan = (plan: Awaited<ReturnType<typeof makePlan>>) => ({
  today: plan.today,
  requiredPerDay: plan.requiredPerDay,
  budget: plan.budget,
  introducedToday: plan.introducedToday,
  shortfall: plan.shortfall,
  newWords: idsOf(plan.newRefs),
  reviews: plan.reviews.map((r) => r.ref.id),
  deadlines: plan.deadlines,
  backlog: { wordIds: idsOf(plan.backlog.refs), lessons: plan.backlog.lessons },
  courses: plan.courses.map(
    ({ courseId, newItemsPerDay, budget, introducedToday, newRefs, requiredPerDay, shortfall }) => ({
      courseId,
      newWordsPerDay: newItemsPerDay,
      budget,
      introducedToday,
      newWordIds: idsOf(newRefs),
      requiredPerDay,
      shortfall,
    }),
  ),
});

/** Результаты для одного источника; тот же набор проверок применяется к снимку и к базе. Эталон записан до типизированных ссылок, поэтому ссылки словарных сценариев сворачиваются в прежние идентификаторы слов. */
export async function recordFor(source: SessionSource, practiceIds: string[]) {
  return {
    plan: stripPlan(await makePlan(source, now)),
    scheduled: stripSession(await makeSession({ source, now, random: mulberry32(7) })),
    spoken: stripSession(await makeSession({ source, now, random: mulberry32(7), hasVoice: true })),
    practice: stripSession(
      await makeSession({ source, now, random: mulberry32(11), mode: "practice", refs: practiceIds.map(wordRef) }),
    ),
  };
}
export async function recordGolden() {
  const out: Record<string, unknown> = {};
  for (const [name, data] of Object.entries(scenarios))
    out[name] = await recordFor(
      fromSnapshot(data),
      data.words.slice(0, 3).map((w) => w.id),
    );
  return out;
}

describe("эталон планировщика", () => {
  it("совпадает с зафиксированными сценариями", async () => {
    const actual = await recordGolden();
    if (!existsSync(FIXTURE) || process.env.UPDATE_GOLDEN === "1") {
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 1));
      return;
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
