import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { checkItem } from "../src/domain/course";
import { PROFILES } from "../src/domain/language";
import { gapAnswer, gapOf, gapped, gapWord } from "../src/domain/word-gap";
import type { Phrase, ReviewEvent, Session, SessionItem } from "../src/domain/types";
import { AppDatabase } from "../src/storage/db";
import { submitAnswer } from "./helpers/ops";
import { doneRows } from "../src/features/learning/notebook";
import { decodeSnapshot, encodeSnapshot } from "../src/sync/codec";
import { SNAPSHOT_FORMAT, type CompactSnapshot } from "../src/sync/types";

const el = PROFILES.el;
const KEY = "Είμαι παντρεμένη και έχω δύο παιδιά.";

describe("ошибка в одном слове фразы", () => {
  it("замена одного слова даёт его номер", () => {
    expect(gapOf("Είμαι παντρεμένη και έχω δύο παιδί.", KEY, el)).toBe(5);
  });
  it("пропуск одного слова даёт номер пропущенного", () => {
    expect(gapOf("Είμαι παντρεμένη έχω δύο παιδιά", KEY, el)).toBe(2);
    expect(gapOf("παντρεμένη και έχω δύο παιδιά", KEY, el)).toBe(0);
  });
  it("лишнее слово, две ошибки и короткая фраза — без пропуска", () => {
    expect(gapOf("Είμαι πολύ παντρεμένη και έχω δύο παιδιά", KEY, el)).toBeNull();
    expect(gapOf("Είμαι παντρεμένος και έχω τρία παιδιά", KEY, el)).toBeNull();
    expect(gapOf("Με λένε Μαρία.", "Με λένε Άννα.", el)).toBeNull();
  });
  it("различие только в пунктуации — без пропуска", () => {
    expect(gapOf("Είμαι παντρεμένη, και έχω δύο παιδιά!", KEY, el)).toBeNull();
  });
  it("остальные слова без ударений не мешают найти ошибку", () => {
    expect(gapOf("Ειμαι παντρεμενη και εχω δυο παιδι", KEY, el)).toBe(5);
  });
  it("повтор слова: пропуск на первой подходящей позиции", () => {
    expect(gapOf("Το παιδί και το είναι εδώ.", "Το παιδί και το σκυλί είναι εδώ.", el)).toBe(4);
  });
  it("отдельное тире номер не сдвигает", () => {
    expect(gapOf("— Τι κάνεις εσύ σήμερα, Μαρία;", "— Τι κάνεις εσύ σήμερα, Άννα;", el)).toBe(4);
  });
  it("потерянное или подменённое отрицание — без пропуска", () => {
    expect(gapOf("Σήμερα μπορώ να έρθω", "Σήμερα δεν μπορώ να έρθω", el)).toBeNull();
    expect(gapOf("Σήμερα όχι μπορώ να έρθω", "Σήμερα δεν μπορώ να έρθω", el)).toBeNull();
  });
  it("ошибка в числе вместе с другой ошибкой — без пропуска", () => {
    expect(gapOf("Έχω 3 παιδιά και σκύλο", "Έχω 2 παιδιά και σκύλο τώρα", el)).toBeNull();
    expect(gapOf("Έχω 2 παιδιά και σκύλο", "Έχω 2 παιδιά και σκύλο τώρα", el)).toBe(4);
  });
  it("в пропуске апостроф элизии слово не меняет", () => {
    expect(gapAnswer("σ'")).toBe("σ");
    expect(gapWord("Σ' αγαπώ πολύ, Άννα μου.", 0)).toBe("Σ");
  });
  it("английский курс — без пропуска", () => {
    expect(gapOf("I like strong black tea", "I like strong green tea", PROFILES.en)).toBeNull();
  });
  it("проверка заданий урока не меняется: ошибка в одном слове длинного ответа — по-прежнему неверно", () => {
    expect(checkItem({ format: "text" }, { answer: [KEY] }, "Είμαι παντρεμένη και έχω δύο παιδί.").status).toBe(
      "wrong",
    );
  });
});

describe("попытка с пропуском в занятии", () => {
  const phrase: Phrase = {
    id: "p-family",
    text: KEY,
    translation: "Я замужем, у меня двое детей.",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
  const item = (over: Partial<SessionItem> = {}): SessionItem => ({
    id: "s-0",
    ref: { kind: "phrase", id: phrase.id },
    unitKey: JSON.stringify(["phrase", phrase.id]),
    card: { kind: "phrase", phrase },
    type: "spelling",
    options: [],
    isNew: false,
    mode: "scheduled",
    expectedVersion: 0,
    ...over,
  });
  let db: AppDatabase;
  beforeEach(async () => {
    await new AppDatabase("tetradio-word-gap").delete();
    db = new AppDatabase("tetradio-word-gap");
    await db.open();
  });
  afterEach(() => db.close());

  it("ошибка в одном слове: оценка «снова», попытка через 3 позиции спрашивает слово в пропуске", async () => {
    const session: Session = {
      id: "s",
      createdAt: "2026-10-12T09:00:00Z",
      planDate: "2026-10-12",
      items: [item(), item({ id: "s-1" }), item({ id: "s-2" }), item({ id: "s-3" })],
      index: 0,
      status: "active",
      activeTimeMs: 0,
    };
    await db.sessions.put(session);
    const event = await submitAnswer({
      session,
      item: session.items[0],
      correct: false,
      answer: "Είμαι παντρεμένη και έχω δύο παιδί.",
      status: "wrong",
      responseTimeMs: 4000,
      activeTimeMs: 0,
      timezone: "UTC",
      database: db,
    });
    expect(event.rating).toBe(Rating.Again);
    const stored = (await db.sessions.get("s"))!;
    const retry = stored.items[3];
    expect(retry).toMatchObject({ type: "wordGap", gap: 5, mode: "practice", retryOf: "s-0", options: [] });
    expect(gapped(KEY, 5)).toBe("Είμαι παντρεμένη και έχω δύο ___.");
    expect(gapWord(KEY, 5)).toBe("παιδιά");
  });

  it("строка «Сделано»: вопрос — фраза с пропуском, ответ — слово", () => {
    const retry = item({ id: "s-0-retry", type: "wordGap", gap: 5, mode: "practice", eventId: "e1" });
    const event = { id: "e1", answer: "παιδιά", correct: true, rating: Rating.Good } as ReviewEvent;
    const [row] = doneRows({ items: [retry] }, new Map([["e1", event]]));
    expect(row.promptGreek && row.expectedGreek).toBe(true);
    expect(row).toMatchObject({
      prompt: "Είμαι παντρεμένη και έχω δύο ___.",
      expected: "παιδιά",
      given: "παιδιά",
      mark: "correct",
    });
  });

  it("тип пропуска проходит круг облачного кодирования", () => {
    const ref = { kind: "phrase" as const, id: phrase.id };
    const snapshot: CompactSnapshot = {
      format: SNAPSHOT_FORMAT,
      createdAt: "2026-10-12T09:00:00.000Z",
      lessons: [],
      packages: [],
      blocks: [],
      states: [],
      skills: [
        {
          ref,
          skills: {
            types: { wordGap: { recent: [true], lastAt: "2026-10-12T09:00:00.000Z" } },
            lastTypes: ["wordGap"],
            cleanAssemblies: 0,
          },
        },
      ],
      stats: { days: [], recentByType: { wordGap: [true] }, answers: 1, answeredKeys: [] },
    };
    const decoded = decodeSnapshot(encodeSnapshot(snapshot));
    expect(decoded.skills[0].skills.types.wordGap?.recent).toEqual([true]);
    expect(decoded.stats.recentByType.wordGap).toEqual([true]);
  });
});
