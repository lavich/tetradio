import { describe, expect, it } from "vitest";
import { mergeSnapshots, normalize, type MergeInput } from "../src/sync/merge";
import type { CompactSnapshot, CompactState } from "../src/sync/types";
import type { SkillSummary } from "../src/domain/skills";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 8, minute)).toISOString();
const card = (lastReview: number, stability = 1) => ({
  due: at(lastReview + 60),
  stability,
  difficulty: 5,
  elapsed_days: 0,
  scheduled_days: 1,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  last_review: at(lastReview),
});
const state = (id: string, lastReview: number, stability = 1): CompactState => ({
  ref: { kind: "word", id },
  card: card(lastReview, stability),
  introducedAt: at(0),
  version: 1,
});
const skill = (spelling: boolean[], lastAt: number, clean: number): SkillSummary => ({
  types: { spelling: { recent: spelling, lastAt: at(lastAt) } },
  lastTypes: ["spelling"],
  cleanAssemblies: clean,
});
function snapshot(patch: Partial<CompactSnapshot> = {}): CompactSnapshot {
  return normalize({
    format: 6,
    createdAt: at(0),
    lessons: [],
    packages: [],
    blocks: [],
    states: [],
    skills: [],
    stats: { days: [], recentByType: {}, answers: 0, answeredKeys: [] },
    ...patch,
  });
}
const input = (snap: CompactSnapshot, format = 6): MergeInput => ({ snapshot: snap, format });
const merge = (base: CompactSnapshot, ...branches: CompactSnapshot[]) =>
  mergeSnapshots(
    input(base),
    branches.map((branch) => input(branch)),
    at(99),
  );
const KEY_A = JSON.stringify(["word", "a"]);
const content = (snap: CompactSnapshot) => JSON.stringify({ ...snap, createdAt: "" });

describe("слияние снимков: поля", () => {
  it("карточка изменена одной стороной — её состояние; обеими — более поздний ответ", () => {
    const base = snapshot({ states: [state("a", 1), state("b", 1)] });
    const phone = snapshot({ states: [state("a", 5, 2), state("b", 1)] });
    const mac = snapshot({ states: [state("a", 3, 9), state("b", 4, 3)] });
    const merged = merge(base, phone, mac);
    const byId = Object.fromEntries(merged.states.map((s) => [s.ref.id, s]));
    expect(byId.a.card.stability).toBe(2);
    expect(byId.a.version).toBe(2);
    expect(byId.b.card.stability).toBe(3);
  });

  it("новая карточка с одной стороны появляется; удалённая одной и изменённая другой — остаётся изменённой", () => {
    const base = snapshot({ states: [state("a", 1)] });
    const phone = snapshot({ states: [state("n", 2)] });
    const mac = snapshot({ states: [state("a", 3, 7)] });
    const ids = merge(base, phone, mac).states.map((s) => s.ref.id);
    expect(ids).toEqual(["a", "n"]);
  });

  it("урок: пройден, если пройден хотя бы на одной стороне; отсутствие урока — не удаление", () => {
    const lesson = (completed: boolean, minute: number) => ({ id: "m01-1", completed, updatedAt: at(minute) });
    const base = snapshot({ lessons: [lesson(false, 0)] });
    expect(
      merge(base, snapshot({ lessons: [lesson(true, 2)] }), snapshot({ lessons: [lesson(false, 5)] })).lessons,
    ).toEqual([lesson(true, 5)]);
    expect(merge(base, snapshot({ lessons: [lesson(true, 2)] }), snapshot()).lessons).toEqual([lesson(true, 2)]);
  });

  it("блок берётся целиком по более позднему изменению: «Повторить» не смешивается с чужим счётом", () => {
    const done = {
      lessonId: "m01-1",
      blockId: "b1",
      done: true,
      score: { correct: 3, almost: 0, total: 3 },
      updatedAt: at(2),
    };
    const retry = { lessonId: "m01-1", blockId: "b1", done: false, updatedAt: at(4) };
    const merged = merge(snapshot(), snapshot({ blocks: [done] }), snapshot({ blocks: [retry] }));
    expect(merged.blocks).toEqual([retry]);
  });

  it("статистика: приросты обеих сторон складываются, день за окном у ветви не вычитается", () => {
    const stats = (answers: number, days: [string, number][]) => ({
      days: days.map(([date, count]) => ({ date, answers: count, keys: [KEY_A] })),
      recentByType: {},
      answers,
      answeredKeys: [KEY_A],
    });
    const base = snapshot({
      stats: stats(10, [
        ["2026-09-01", 4],
        ["2026-09-20", 6],
      ]),
    });
    const phone = snapshot({ stats: stats(13, [["2026-09-20", 9]]) });
    const mac = snapshot({
      stats: stats(15, [
        ["2026-09-01", 4],
        ["2026-09-20", 6],
        ["2026-09-21", 5],
      ]),
    });
    const merged = merge(base, phone, mac);
    expect(merged.stats.answers).toBe(18);
    expect(merged.stats.days).toEqual([
      { date: "2026-09-01", answers: 4, keys: [KEY_A] },
      { date: "2026-09-20", answers: 9, keys: [KEY_A] },
      { date: "2026-09-21", answers: 5, keys: [KEY_A] },
    ]);
  });

  it("чистые сборки: без сбросов приросты складываются, сброс одной стороны задаёт счёт", () => {
    const ref = { kind: "word" as const, id: "a" };
    const base = snapshot({ skills: [{ ref, skills: skill([true], 1, 2) }] });
    const grew = (clean: number, minute: number) =>
      snapshot({ skills: [{ ref, skills: skill([true, true], minute, clean) }] });
    expect(merge(base, grew(3, 2), grew(5, 3)).skills[0].skills.cleanAssemblies).toBe(6);
    const reset = snapshot({ skills: [{ ref, skills: skill([true, false], 4, 0) }] });
    expect(merge(base, grew(5, 3), reset).skills[0].skills.cleanAssemblies).toBe(0);
  });

  it("ветвь формата 4 не удаляет карточку незнакомого вида", () => {
    const foreign: CompactState = { ...state("z", 1), ref: { code: "q", id: "z" } };
    const base = snapshot({ states: [foreign, state("a", 1)] });
    const old = snapshot({ states: [state("a", 3)] });
    const merged = mergeSnapshots(input(base), [input(old, 4), input(base)], at(99));
    expect(merged.states.map((s) => s.ref.id).sort()).toEqual(["a", "z"]);
  });
});

/** Детерминированный генератор: свойства проверяются на одних и тех же снимках при каждом прогоне. */
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
function evolve(random: () => number, from: CompactSnapshot, start: number): CompactSnapshot {
  const ids = ["a", "b", "c", "d", "e"];
  const states = new Map(from.states.map((s) => [s.ref.id, s]));
  let answers = from.stats.answers;
  const days = new Map(from.stats.days.map((day) => [day.date, { ...day }]));
  const steps = 1 + Math.floor(random() * 4);
  for (let step = 0; step < steps; step++) {
    const id = ids[Math.floor(random() * ids.length)];
    const minute = start + step;
    states.set(id, state(id, minute, Math.round(random() * 100) / 10));
    answers++;
    const date = `2026-09-${String(10 + Math.floor(random() * 3)).padStart(2, "0")}`;
    const day = days.get(date) ?? { date, answers: 0, keys: [] };
    day.answers++;
    if (!day.keys.includes(JSON.stringify(["word", id]))) day.keys.push(JSON.stringify(["word", id]));
    days.set(date, day);
  }
  return snapshot({
    states: [...states.values()].sort((a, b) => a.ref.id.localeCompare(b.ref.id)),
    stats: {
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      recentByType: {},
      answers,
      answeredKeys: [],
    },
  });
}

describe("слияние снимков: свойства", () => {
  const cases = Array.from({ length: 60 }, (_, index) => {
    const random = seeded(index + 1);
    const base = evolve(random, snapshot(), 0);
    return { base, x: evolve(random, base, 10), y: evolve(random, base, 20), z: evolve(random, base, 30) };
  });

  it("одна ветвь и ветвь, равная предку, дают эту ветвь; две равные ветви — те же состояния карточек", () => {
    for (const { base, x } of cases) {
      expect(content(merge(base, x))).toBe(content(x));
      expect(content(merge(base, base, x))).toBe(content(x));
      expect(merge(base, x, x).states).toEqual(x.states);
    }
  });

  it("результат не зависит от порядка ветвей", () => {
    for (const { base, x, y, z } of cases) {
      const expected = content(merge(base, x, y, z));
      expect(content(merge(base, z, x, y))).toBe(expected);
      expect(content(merge(base, y, z, x))).toBe(expected);
    }
  });

  it("ответы не теряются и не удваиваются: итог — предок плюс приросты всех ветвей", () => {
    for (const { base, x, y } of cases) {
      const merged = merge(base, x, y);
      expect(merged.stats.answers).toBe(x.stats.answers + y.stats.answers - base.stats.answers);
      const perDay = (snap: CompactSnapshot) => snap.stats.days.reduce((sum, day) => sum + day.answers, 0);
      expect(perDay(merged)).toBe(perDay(x) + perDay(y) - perDay(base));
    }
  });

  it("слияние результата с его предком ничего не добавляет", () => {
    for (const { base, x, y } of cases) {
      const merged = merge(base, x, y);
      expect(content(merge(x, merged))).toBe(content(merged));
      expect(content(merge(merged, merged, merged))).toBe(content(merged));
    }
  });
});
