import { describe, expect, it } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
import { returnDays } from "../src/features/learning/ResultScreen";
import { answersLine, cardOutcomes, limitNames, splitRows } from "../src/features/learning/result";
import type { DoneRow } from "../src/features/learning/notebook";
import { fromSnapshot, type Snapshot } from "./helpers/snapshot-source";
import { LEECH_LAPSES, lessonProgress, progress, SKILL_NAMES, SKILL_TYPES, SOLID_DAYS } from "../src/domain/stats";
import { studyDay } from "../src/domain/learning";
import { foldStats, emptyStats } from "../src/domain/skills";
import {
  type CardKind,
  type LearningRef,
  type LearningState,
  type Phrase,
  type ReviewEvent,
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
  localDate: studyDay(new Date(at), "Asia/Nicosia"),
  responseTimeMs: 900,
  ...over,
});
const base = (over: Partial<Snapshot>): Snapshot => ({
  words: [],
  lessons: [],
  links: [],
  states: [],
  events: [],
  sessions: [],
  ...over,
});

describe("результат смешанного занятия", () => {
  it("повторная попытка той же фразы не увеличивает число уникальных карточек", () => {
    const events = [
      event(wordRef("w1"), "recognition", true, "2026-09-15T08:00:00Z"),
      event(wordRef("w2"), "spelling", false, "2026-09-15T08:01:00Z"),
      event(ref("phrase", "p1"), "spelling", false, "2026-09-15T08:02:00Z"),
      event(ref("phrase", "p1"), "recognition", true, "2026-09-15T08:03:00Z", { mode: "practice", id: "retry" }),
    ];
    const outcome = cardOutcomes(events);
    expect(events).toHaveLength(4);
    expect(outcome.cells).toEqual(["clean", "wrong", "wrong"]);
    expect(outcome.clean).toBe(1);
  });
  it("карточка снятого вида входит в общее число карточек", () => {
    const events = [
      event(wordRef("w1"), "recognition", true, "2026-09-15T08:00:00Z"),
      event(dropped("c1"), "cloze", true, "2026-09-15T08:01:00Z"),
    ];
    expect(cardOutcomes(events).cells).toHaveLength(2);
  });
  it("только «почти» даёт янтарную клетку, любая другая ошибка — красную, порядок по времени ответа", () => {
    const almost = (r: LearningRef, at: string, over: Partial<ReviewEvent> = {}) =>
      event(r, "spelling", false, at, { rating: 2, ...over });
    const events = [
      event(wordRef("w3"), "spelling", true, "2026-09-15T08:03:00Z"),
      almost(wordRef("w1"), "2026-09-15T08:01:00Z"),
      almost(wordRef("w2"), "2026-09-15T08:02:00Z"),
      event(wordRef("w2"), "spelling", false, "2026-09-15T08:02:30Z", { id: "again" }),
    ];
    expect(cardOutcomes(events).cells).toEqual(["almost", "wrong", "clean"]);
  });
  it("без ответов нет клеток", () => {
    expect(cardOutcomes([])).toEqual({ cells: [], corrected: new Set(), clean: 0 });
  });
});

describe("группы строк итога", () => {
  const row = (id: string, unitKey: string, mark: DoneRow["mark"]): DoneRow => ({
    id,
    unitKey,
    prompt: "",
    promptGreek: true,
    expected: "",
    expectedGreek: true,
    given: "",
    mark,
  });
  it("обе попытки карточки с ошибкой идут в первую группу, N считает карточки, пропуск отдельно", () => {
    const rows = [
      row("1", "a", "correct"),
      row("2", "b", "wrong"),
      row("3", "b", "correct"),
      row("4", "c", "skipped"),
      row("5", "d", "almost"),
    ];
    const groups = splitRows(rows, new Set(["b", "d"]));
    expect(groups.fixed.map((r) => r.id)).toEqual(["2", "3", "5"]);
    expect(groups.fixedCards).toBe(2);
    expect(groups.skipped.map((r) => r.id)).toEqual(["4"]);
    expect(groups.clean.map((r) => r.id)).toEqual(["1"]);
  });
  it("без ошибок все строки в нижней группе", () => {
    const groups = splitRows([row("1", "a", "correct")], new Set());
    expect(groups).toMatchObject({ fixed: [], skipped: [], fixedCards: 0 });
    expect(groups.clean).toHaveLength(1);
  });
});

describe("строка ответов и точности", () => {
  const answered = (correct: boolean | null) => ({ correct });
  it("все ответы с проверкой: число ответов, точность, минуты", () => {
    const events = [answered(true), answered(true), answered(true), answered(false)];
    expect(answersLine(events, 7 * 60000 + 12000)).toBe("4 ответа · точность 75% · 7 минут");
  });
  it("часть ответов без проверки называется числом проверяемых", () => {
    expect(
      answersLine(
        [
          ...Array<boolean | null>(18).fill(true),
          ...Array<boolean | null>(4).fill(false),
          ...Array<boolean | null>(4).fill(null),
        ].map(answered),
        5 * 60000,
      ),
    ).toBe("26 ответов · точность 82% по 22 проверяемым · 5 минут");
  });
  it("без проверяемых ответов точности нет", () => {
    expect(answersLine([answered(null)], 0)).toBe("1 ответ · самооценка, точности нет · 1 минута");
  });
});

describe("слова блока «Вернутся»", () => {
  it("шесть слов показываются целиком, седьмое уходит в «и ещё»", () => {
    const names = ["a", "b", "c", "d", "e", "f"];
    expect(limitNames(names)).toEqual({ shown: names, rest: 0 });
    expect(limitNames([...names, "g"])).toEqual({ shown: names, rest: 1 });
  });
});

describe("статистика занятия", () => {
  it("историческая самооценка не создаёт объективных попыток, а без наблюдений навык «ещё не проверяли»", async () => {
    const data = base({ events: [event(wordRef("w1"), "recall", null, "2026-09-14T09:00:00Z", { rating: 3 })] });
    const stats = await progress(fromSnapshot(data), now);
    expect(stats.totals).toEqual({ answers: 1, cards: 1, byKind: { word: 1, phrase: 0, mistake: 0 } });
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
  it("ответ после полуночи относится к учебному дню выбранной зоны, и день считает уникальные карточки любого вида", async () => {
    const late = event(ref("phrase", "p1"), "spelling", true, "2026-09-14T22:30:00Z"); // 01:30 15 сентября в Никосии
    const again = event(ref("phrase", "p1"), "spelling", false, "2026-09-14T22:40:00Z", { id: "again" });
    const word = event(wordRef("w1"), "spelling", true, "2026-09-14T22:45:00Z");
    const stats = await progress(fromSnapshot(base({ events: [late, again, word] })), now);
    const day = stats.days.find((d) => d.date === "2026-09-14")!;
    expect(day).toEqual({ date: "2026-09-14", answers: 3, cards: 2 });
    expect(stats.days.find((d) => d.date === "2026-09-15")!.answers).toBe(0);
    expect(stats.skills.find((skill) => skill.type === "spelling")).toEqual({
      type: "spelling",
      attempts: 3,
      correct: 2,
      rate: 2 / 3,
    });
    const folded = foldStats(emptyStats(), [late, again, word]);
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
      words: [word("w1", "η λέξη"), word("w2", "το βιβλίο"), word("w3", "ο δρόμος")],
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
  it("состояние без карточки в список не попадает, даже с самым большим числом провалов", async () => {
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

describe("когда вернутся ошибки", () => {
  const tz = "Asia/Nicosia";
  it("срок до 04:00 завтра — сегодня, после — завтра", () => {
    // 23:50 15 октября в Никосии.
    const at = new Date("2026-10-15T20:50:00Z");
    expect(
      returnDays(at, tz, [
        { due: "2026-10-15T21:00:00Z", label: "α" },
        { due: "2026-10-16T01:30:00Z", label: "β" },
        { due: "2026-10-18T09:00:00Z", label: "γ" },
      ]),
    ).toEqual([
      ["сегодня", ["α"]],
      ["завтра", ["β"]],
      ["18 октября", ["γ"]],
    ]);
  });
  it("в ночь перевода на летнее время «завтра» не пропадает", () => {
    // 23:00 28 марта в Никосии; сутки до 04:00 29-го — 23 часа.
    expect(returnDays(new Date("2026-03-28T21:00:00Z"), tz, [{ due: "2026-03-29T07:00:00Z", label: "α" }])).toEqual([
      ["завтра", ["α"]],
    ]);
  });
});
