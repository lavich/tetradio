import { describe, expect, it } from "vitest";
import { makeLanguagePlan, makeSession } from "../src/domain/learning";
import { SESSION_SIZE } from "../src/domain/session";
import { wordRef } from "../src/domain/refs";
import type { SessionItem, Word } from "../src/domain/types";
import { fromSnapshot, type Snapshot } from "./helpers/snapshot-source";
import {
  languageSnapshot,
  mistakeKey,
  mistakeOf,
  NOW,
  phraseOf,
  reviewOf,
  wordKey,
  wordOf,
} from "./helpers/language-fixture";

const english = ["it", "travel"];
const lastDue =
  (count: number, at = "2026-09-14T09:00:00Z") =>
  (words: Word[]) =>
    words.slice(words.length - count).map((word) => reviewOf(wordKey(word), at));
const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const course = (item: Pick<SessionItem, "ref">) =>
  item.ref.id.startsWith("i") ? "it" : item.ref.id.startsWith("t") ? "travel" : "greek";
const count = (items: SessionItem[], test: (item: SessionItem) => boolean) => items.filter(test).length;
const textsOf = (data: Snapshot, prefix: string) =>
  new Set([
    ...data.words.filter((word) => word.id.startsWith(prefix)).flatMap((word) => [word.greek, word.russian]),
    ...(data.phrases ?? [])
      .filter((phrase) => phrase.id.startsWith(prefix))
      .flatMap((phrase) => [phrase.text, phrase.translation ?? ""]),
  ]);

describe("занятие языка — карточки его курсов в одном занятии", () => {
  it("20 мест: новые до половины по очереди курсов, остальное — повторения", async () => {
    const data = languageSnapshot({
      it: { words: 20, states: lastDue(8) },
      travel: { words: 10, states: lastDue(7) },
    });
    const session = await makeSession({ source: fromSnapshot(data), now: NOW, courseIds: english, random: seeded(1) });
    expect(session.items).toHaveLength(SESSION_SIZE);
    const fresh = session.items.filter((item) => item.isNew);
    expect(count(fresh, (item) => course(item) === "it")).toBe(7);
    expect(count(fresh, (item) => course(item) === "travel")).toBe(3);
    expect(count(session.items, (item) => !item.isNew)).toBe(10);
  });
  it("8 + 8 новых без повторений — все 16", async () => {
    const data = languageSnapshot({ it: { words: 8 }, travel: { words: 8 } });
    const session = await makeSession({ source: fromSnapshot(data), now: NOW, courseIds: english, random: seeded(2) });
    expect(session.items).toHaveLength(16);
    expect(count(session.items, (item) => course(item) === "it")).toBe(8);
  });
  it("долг паузы одного курса — ни одной новой карточки обоих курсов", async () => {
    const data = languageSnapshot(
      {
        it: { words: 6, states: lastDue(3, "2026-09-02T09:00:00Z") },
        travel: { words: 8, states: lastDue(2) },
      },
      { it: { pausedAt: null, resumedAt: "2026-09-15T08:00:00Z" } },
    );
    const session = await makeSession({ source: fromSnapshot(data), now: NOW, courseIds: english, random: seeded(3) });
    expect(session.items).toHaveLength(5 + 9);
    expect(count(session.items, (item) => item.isNew)).toBe(9);
    const reviews = session.items.filter((item) => !item.isNew);
    expect(reviews).toHaveLength(5);
    const strict = languageSnapshot(
      {
        it: { words: 25, states: lastDue(25, "2026-09-02T09:00:00Z") },
        travel: { words: 8, states: lastDue(2) },
      },
      { it: { pausedAt: null, resumedAt: "2026-09-15T08:00:00Z" } },
    );
    const full = await makeSession({ source: fromSnapshot(strict), now: NOW, courseIds: english, random: seeded(3) });
    expect(full.items).toHaveLength(SESSION_SIZE);
    expect(count(full.items, (item) => item.isNew)).toBe(0);
    expect(full.items.every((item) => course(item) === "it")).toBe(true);
  });
  it("ошибки одного курса — не больше половины мест повторений занятия языка", async () => {
    const mistakes = Array.from({ length: 20 }, (_, i) => mistakeOf("it", i));
    const data = languageSnapshot({
      it: { mistakes, states: () => mistakes.map((item) => reviewOf(mistakeKey(item), "2026-09-10T09:00:00Z")) },
      travel: { words: 15, states: lastDue(15, "2026-09-14T09:00:00Z") },
    });
    const session = await makeSession({ source: fromSnapshot(data), now: NOW, courseIds: english, random: seeded(4) });
    expect(session.items).toHaveLength(SESSION_SIZE);
    expect(count(session.items, (item) => item.ref.kind === "mistake")).toBe(10);
    expect(count(session.items, (item) => course(item) === "travel")).toBe(10);
  });
  it("варианты слова и фразы — из его курса, не из другого курса занятия", async () => {
    const data = languageSnapshot({
      it: { words: 10, phrases: [0, 1, 2, 3].map((i) => phraseOf("it", i)) },
      travel: { words: 10, phrases: [0, 1, 2, 3].map((i) => phraseOf("travel", i)) },
    });
    for (const seed of [5, 6, 7]) {
      const session = await makeSession({
        source: fromSnapshot(data),
        now: NOW,
        courseIds: english,
        random: seeded(seed),
      });
      expect(count(session.items, (item) => course(item) === "it")).toBeGreaterThan(0);
      for (const item of session.items) {
        const own = textsOf(data, course(item) === "it" ? "i" : "t");
        expect(item.options.every((option) => own.has(option))).toBe(true);
      }
    }
  });
  it("занятие хранит язык и первый курс; голос — английский", async () => {
    const voices: string[] = [];
    const data = languageSnapshot({ it: { words: 4 }, travel: { words: 4 }, greek: { words: 4 } });
    const session = await makeSession({
      source: fromSnapshot(data),
      now: NOW,
      courseIds: english,
      random: seeded(8),
      hasVoice: (language) => (voices.push(language), true),
    });
    expect(session.language).toBe("en");
    expect(session.courseId).toBe("it");
    expect(new Set(voices)).toEqual(new Set(["en"]));
  });
  it("занятие курса тоже хранит язык", async () => {
    const data = languageSnapshot({ it: { words: 4 }, greek: { words: 4 } });
    const session = await makeSession({ source: fromSnapshot(data), now: NOW, courseId: "greek", random: seeded(9) });
    expect(session).toMatchObject({ courseId: "greek", language: "el" });
  });
  it("страж: с одним курсом занятие совпадает с занятием курса — и с долгом паузы и фразами", async () => {
    const plain = languageSnapshot({
      it: {
        words: 14,
        phrases: [0, 1, 2, 3, 4].map((i) => phraseOf("it", i, i !== 2)),
        states: lastDue(6, "2026-09-03T09:00:00Z"),
      },
      travel: { words: 6, states: lastDue(3) },
    });
    for (const data of [plain, { ...plain, pauses: { it: { pausedAt: null, resumedAt: "2026-09-15T08:00:00Z" } } }])
      for (const seed of [10, 11]) {
        const language = await makeSession({
          source: fromSnapshot(data),
          now: NOW,
          courseIds: ["it"],
          hasVoice: true,
          random: seeded(seed),
        });
        const single = await makeSession({
          source: fromSnapshot(data),
          now: NOW,
          courseId: "it",
          hasVoice: true,
          random: seeded(seed),
        });
        expect(language).toEqual(single);
      }
  });
  it("выбранные карточки — только они, курс каждой — по правилу курса карточки", async () => {
    const data = languageSnapshot(
      { it: { words: 6 }, travel: { words: 6 } },
      { travel: { pausedAt: "2026-09-10T09:00:00Z", resumedAt: null } },
    );
    const refs = [wordRef("i0"), wordRef("i1"), wordRef("t0"), wordRef("t1")];
    const session = await makeSession({
      source: fromSnapshot(data),
      now: NOW,
      courseIds: ["it"],
      refs,
      random: seeded(12),
    });
    expect(session.items.map((item) => item.ref.id).sort()).toEqual(["i0", "i1", "t0", "t1"]);
    for (const item of session.items) {
      const own = textsOf(data, course(item) === "it" ? "i" : "t");
      expect(item.options.every((option) => own.has(option))).toBe(true);
    }
  });
  it("все курсы языка на паузе — занятие выбранных карточек получает язык и курс", async () => {
    const paused = { pausedAt: "2026-09-10T09:00:00Z", resumedAt: null };
    const data = languageSnapshot({ it: { words: 6 }, travel: { words: 6 } }, { it: paused, travel: paused });
    const session = await makeSession({
      source: fromSnapshot(data),
      now: NOW,
      courseIds: english,
      refs: [wordRef("t0"), wordRef("t1")],
      random: seeded(13),
    });
    expect(session.items).toHaveLength(2);
    expect(session).toMatchObject({ language: "en", courseId: "it" });
  });
  it("карточка-сирота другого языка по курсу — варианты из первого курса занятия", async () => {
    const data = languageSnapshot({ it: { words: 6 }, travel: { words: 6 }, greek: { words: 6 } });
    const orphan = { ...wordOf("it", 99), id: "orphan" };
    data.words.push(orphan);
    const voices: string[] = [];
    const session = await makeSession({
      source: fromSnapshot(data),
      now: NOW,
      courseIds: english,
      refs: [wordRef("orphan"), wordRef("t0")],
      random: seeded(14),
      hasVoice: (language) => (voices.push(language), true),
    });
    expect(new Set(voices)).toEqual(new Set(["en"]));
    const item = session.items.find((entry) => entry.ref.id === "orphan")!;
    expect(item.options.length).toBeGreaterThan(0);
    const own = new Set([...textsOf(data, "i"), orphan.greek, orphan.russian]);
    expect(item.options.every((option) => own.has(option))).toBe(true);
  });
  it("выбранные карточки — без плана: состояния со сроком не читаются, источники новых — прежние", async () => {
    const data = languageSnapshot({ it: { words: 6, states: lastDue(2) }, travel: { words: 6, states: lastDue(2) } });
    const source = fromSnapshot(data);
    const due: unknown[] = [];
    const counted = {
      ...source,
      dueStates: (...args: Parameters<typeof source.dueStates>) => (due.push(args), source.dueStates(...args)),
      dueStatesOf: undefined,
    };
    const session = await makeSession({
      source: counted,
      now: NOW,
      courseIds: english,
      refs: [wordRef("i0"), wordRef("t0"), wordRef("t5")],
      random: seeded(15),
    });
    expect(due).toEqual([]);
    expect(session.planDate).toBe("2026-09-15");
    expect(session.items.find((item) => item.ref.id === "i0")?.lessonTitle).toBe("it урок");
    expect(session.items.find((item) => item.ref.id === "t5")?.lessonTitle).toBeUndefined();
  });
  it("план языка читает срок одним проходом на все курсы и не повторяет карточки", async () => {
    const data = languageSnapshot({ it: { words: 4, states: lastDue(2) }, travel: { words: 4, states: lastDue(2) } });
    const source = fromSnapshot(data);
    const passes: unknown[] = [];
    const counted = {
      ...source,
      dueStates: async () => {
        throw new Error("срок по курсу");
      },
      dueStatesOf: (...args: Parameters<NonNullable<typeof source.dueStatesOf>>) => (
        passes.push(args),
        source.dueStatesOf!(...args)
      ),
    };
    const plan = await makeLanguagePlan(counted, NOW, { courseIds: english });
    expect(passes).toHaveLength(1);
    expect(plan.reviews).toHaveLength(4);
    const keys = [...plan.newRefs, ...plan.reviews.map((review) => review.ref)].map((ref) => ref.id);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
