import { describe, expect, it } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
import { compositionText } from "../src/features/learning/ResultScreen";
import { compositionLabel } from "../src/features/lessons/LessonScreen";
import { fromSnapshot } from "../src/domain/snapshot-source";
import { LEECH_LAPSES, lessonProgress, progress, SKILL_NAMES, SKILL_TYPES, SOLID_DAYS } from "../src/domain/stats";
import { localDay } from "../src/domain/learning";
import { foldStats, emptyStats } from "../src/domain/skills";
import {
  defaultSettings,
  type CardKind,
  type LearningRef,
  type LearningState,
  type Phrase,
  type ReviewEvent,
  type Snapshot,
} from "../src/domain/types";
import { unitKey, wordRef } from "./helpers/cards";

const now = new Date("2026-09-15T09:00:00Z");
const iso = now.toISOString();
const ref = (kind: CardKind, id: string): LearningRef => ({ kind, id });
/** Ссылка снятого вида: в базе пользователя такие записи остались, в `CardKind` их больше нет. */
const dropped = (id: string): LearningRef => ({ kind: "cloze", id }) as unknown as LearningRef;
const event = (
  r: LearningRef,
  type: ReviewEvent["type"],
  correct: boolean | null,
  at: string,
  over: Partial<ReviewEvent> = {},
): ReviewEvent => ({
  id: `${r.kind}-${r.id}-${type}-${at}`,
  sessionId: "s",
  itemId: `${r.kind}-${r.id}-${at}`,
  ref: r,
  unitKey: unitKey(r),
  snapshot: r.kind === "word" ? { greek: "", russian: "" } : { text: "" },
  type,
  mode: "scheduled",
  rating: correct === false ? 1 : 3,
  correct,
  answer: "",
  createdAt: at,
  localDate: localDay(new Date(at), "Asia/Nicosia"),
  responseTimeMs: 900,
  ...over,
});
/** Уникальные карточки сессии по видам — то же правило, что на экране результата. */
function uniqueByKind(events: ReviewEvent[]) {
  const unique = new Map(events.map((e) => [e.unitKey, e.ref]));
  const byKind: Record<CardKind, number> = { word: 0, phrase: 0 };
  for (const r of unique.values()) if (r.kind in byKind) byKind[r.kind]++;
  return { byKind, total: unique.size };
}
const base = (over: Partial<Snapshot>): Snapshot => ({
  words: [],
  lessons: [],
  links: [],
  states: [],
  events: [],
  sessions: [],
  settings: defaultSettings,
  ...over,
});

describe("результат смешанного занятия", () => {
  it("повторная попытка той же фразы не увеличивает число уникальных карточек; состав по видам", () => {
    const events = [
      event(wordRef("w1"), "recognition", true, "2026-09-15T08:00:00Z"),
      event(wordRef("w2"), "spelling", false, "2026-09-15T08:01:00Z"),
      event(ref("phrase", "p1"), "spelling", false, "2026-09-15T08:02:00Z"),
      event(ref("phrase", "p1"), "recognition", true, "2026-09-15T08:03:00Z", { mode: "practice", id: "retry" }),
    ];
    const { byKind, total } = uniqueByKind(events);
    expect(events).toHaveLength(4);
    expect(total).toBe(3);
    expect(compositionText(byKind)).toBe("2 слова · 1 фраза");
    expect(compositionText({ word: 3, phrase: 0 })).toBe("3 слова");
    expect(compositionText({ word: 0, phrase: 2 })).toBe("2 фразы");
  });
  it("карточка снятого вида не занимает разряд в разбивке, но её ответы остаются в общем числе", () => {
    const events = [
      event(wordRef("w1"), "recognition", true, "2026-09-15T08:00:00Z"),
      event(dropped("c1"), "cloze", true, "2026-09-15T08:01:00Z"),
    ];
    const { byKind, total } = uniqueByKind(events);
    expect(events).toHaveLength(2);
    expect(total).toBe(2);
    expect(byKind).toEqual({ word: 1, phrase: 0 });
    expect(compositionText(byKind)).toBe("1 слово");
  });
  it("историческая самооценка не создаёт объективных попыток, а без наблюдений навык «ещё не проверяли»", async () => {
    const data = base({ events: [event(wordRef("w1"), "recall", null, "2026-09-14T09:00:00Z", { rating: 3 })] });
    const stats = await progress(fromSnapshot(data), now);
    expect(stats.totals).toEqual({ answers: 1, cards: 1, byKind: { word: 1, phrase: 0 } });
    expect(stats.skills.find((skill) => skill.type === "listening")).toEqual({
      type: "listening",
      attempts: 0,
      correct: 0,
      rate: null,
    });
    // Ответ на снятый тип остаётся в общем числе, но своей строки в сводке у него нет.
    for (const gone of ["recall", "cloze"] as const) {
      expect(SKILL_TYPES).not.toContain(gone);
      expect(stats.skills.find((skill) => skill.type === gone)).toBeUndefined();
    }
    expect(SKILL_NAMES.cloze).toBe("Заполнение пропуска"); // подпись жива ради старой истории
    const objective = data.events.filter((e) => e.correct !== null);
    expect(objective).toHaveLength(0); // экран показывает «нет данных», а не проценты
  });
  it("понимание на слух занимает свою строку в сводке навыков", async () => {
    const heard = event(wordRef("w1"), "comprehension", true, "2026-09-14T09:00:00Z");
    const missed = event(wordRef("w2"), "comprehension", false, "2026-09-14T09:01:00Z", { id: "missed" });
    const stats = await progress(fromSnapshot(base({ events: [heard, missed] })), now);
    expect(SKILL_TYPES).toContain("comprehension");
    expect(stats.skills.find((skill) => skill.type === "comprehension")).toEqual({
      type: "comprehension",
      attempts: 2,
      correct: 1,
      rate: 0.5,
    });
    expect(SKILL_NAMES.comprehension).toBe("Понимание на слух");
  });
  it("ответ около полуночи относится ко дню выбранной зоны, и день считает уникальные карточки любого вида", async () => {
    const late = event(ref("phrase", "p1"), "spelling", true, "2026-09-14T22:30:00Z"); // 01:30 15 сентября в Никосии
    const again = event(ref("phrase", "p1"), "spelling", false, "2026-09-14T22:40:00Z", { id: "again" });
    const word = event(wordRef("w1"), "spelling", true, "2026-09-14T22:45:00Z");
    const stats = await progress(fromSnapshot(base({ events: [late, again, word] })), now);
    const day = stats.days.find((d) => d.date === "2026-09-15")!;
    expect(day).toEqual({ date: "2026-09-15", answers: 3, cards: 2 });
    expect(stats.days.find((d) => d.date === "2026-09-14")!.answers).toBe(0);
    expect(stats.skills.find((skill) => skill.type === "spelling")).toEqual({
      type: "spelling",
      attempts: 3,
      correct: 2,
      rate: 2 / 3,
    });
    const folded = [late, again, word].reduce((summary, e) => foldStats(summary, e), emptyStats());
    expect(folded.days[0].keys).toEqual([unitKey(ref("phrase", "p1")), unitKey(wordRef("w1"))]);
  });
  it("единый порог устойчивости 21 день для всех видов; устойчивая фраза не делает урок освоенным", () => {
    const state = (r: LearningRef, days: number, fsrs = State.Review): LearningState => ({
      unitKey: unitKey(r),
      ref: r,
      introducedAt: iso,
      version: 1,
      card: { ...createEmptyCard(now), due: now, state: fsrs, scheduled_days: days },
    });
    const states = new Map(
      [
        state(wordRef("w1"), 30),
        state(ref("phrase", "p1"), SOLID_DAYS),
        state(ref("phrase", "p2"), 5),
        state(ref("phrase", "p3"), 0, State.Learning),
      ].map((s) => [s.unitKey, s]),
    );
    const keys = [wordRef("w1"), ref("phrase", "p1"), ref("phrase", "p2"), ref("phrase", "p3"), wordRef("w2")].map(
      unitKey,
    );
    const groups = lessonProgress(keys, states);
    expect(groups).toMatchObject({ solid: 2, review: 2, fresh: 1 });
    expect(groups.solid + groups.review + groups.fresh).toBe(5); // числа строки урока сходятся с составом
    expect(groups.mature).toBeLessThan(5); // «освоенность» урока — доля, а не заявление об освоении темы
    expect(compositionLabel({ word: 1, phrase: 4 })).toBe("5 карточек: 1 слово · 4 фразы");
    expect(compositionLabel({ word: 30, phrase: 0 })).toBe("30 слов");
  });
});

describe("карточки, которые не даются", () => {
  const word = (id: string, greek: string) => ({
    id,
    greek,
    russian: "перевод",
    ipa: "",
    segments: [],
    examples: [],
    verified: false,
    createdAt: iso,
    updatedAt: iso,
  });
  const phrase = (id: string, text: string): Phrase => ({
    id,
    text,
    provenance: { sourceLabel: "тест", operation: "verbatim" },
    createdAt: iso,
    updatedAt: iso,
  });
  const lapsed = (r: LearningRef, lapses: number): LearningState => ({
    unitKey: unitKey(r),
    ref: r,
    introducedAt: iso,
    version: 1,
    card: { ...createEmptyCard(now), state: State.Review, lapses, scheduled_days: 2, reps: lapses + 2 },
  });
  const data = () =>
    base({
      words: [
        word("w1", "η λέξη"),
        word("w2", "το βιβλίο"),
        word("w3", "ο δρόμος"),
        { ...word("w4", "η πόρτα"), deletedAt: iso },
      ],
      phrases: [phrase("p1", "Γράφω κάτι.")],
      states: [
        lapsed(wordRef("w1"), LEECH_LAPSES),
        lapsed(wordRef("w2"), LEECH_LAPSES - 1),
        lapsed(wordRef("w3"), LEECH_LAPSES + 4),
        lapsed(wordRef("w4"), LEECH_LAPSES + 9),
        lapsed(ref("phrase", "p1"), LEECH_LAPSES + 1),
      ],
    });
  it("отбирает по порогу провалов, по убыванию и с подписью карточки", async () => {
    const stats = await progress(fromSnapshot(data()), now);
    expect(stats.leeches.map((entry) => [entry.label, entry.lapses])).toEqual([
      ["ο δρόμος", LEECH_LAPSES + 4],
      ["Γράφω κάτι.", LEECH_LAPSES + 1],
      ["η λέξη", LEECH_LAPSES],
    ]);
  });
  it("удалённая карточка в список не попадает, даже с самым большим числом провалов", async () => {
    const stats = await progress(fromSnapshot(data()), now);
    expect(stats.leeches.some((entry) => entry.ref.id === "w4")).toBe(false);
  });
  it("без провалов список пуст", async () => {
    const stats = await progress(
      fromSnapshot(base({ words: [word("w1", "η λέξη")], states: [lapsed(wordRef("w1"), 0)] })),
      now,
    );
    expect(stats.leeches).toEqual([]);
  });
});
