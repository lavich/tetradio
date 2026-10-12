import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
import { indexWord, AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { makePlan, makeSession } from "../src/domain/learning";
import { SESSION_SIZE } from "../src/domain/session";
import { cardKey, cardLabel, cardSides, KINDS, kindOfCode, snapshotOf } from "../src/domain/kinds";
import { STORED_KINDS } from "../src/storage/kinds";
import { CARD_KINDS, type LearningState, type Phrase, type SessionCard, type Word } from "../src/domain/types";
import { unitKey } from "../src/domain/refs";

const now = new Date("2026-09-15T09:00:00Z");
const iso = now.toISOString();
const word = (index: number): Word => ({
  id: `w${index}`,
  greek: `η λέξη${index}`,
  russian: `слово${index}`,
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: iso,
  updatedAt: iso,
});
const phrase = (index: number, over: Partial<Phrase> = {}): Phrase => ({
  id: `p${index}`,
  text: `Φράση ${index}.`,
  translation: `Фраза ${index}.`,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});
const dueState = (kind: "word" | "phrase", id: string): LearningState => ({
  unitKey: unitKey({ kind, id }),
  ref: { kind, id },
  card: { ...createEmptyCard(new Date("2026-09-01")), due: new Date("2026-09-14T08:00:00Z"), state: State.Review },
  introducedAt: "2026-09-01T09:00:00Z",
  version: 1,
});

describe("перечень видов карточек", () => {
  const wordCard: SessionCard = { kind: "word", word: word(1) };
  const phraseCard: SessionCard = { kind: "phrase", phrase: phrase(1) };

  it("для слов и фраз даёт прежние подписи, снимки и стороны", () => {
    expect(cardLabel(wordCard)).toBe("η λέξη1");
    expect(cardLabel(phraseCard)).toBe("Φράση 1.");
    expect(snapshotOf(wordCard)).toEqual({ greek: "η λέξη1", russian: "слово1" });
    expect(snapshotOf(phraseCard)).toEqual({ text: "Φράση 1.", translation: "Фраза 1." });
    expect(snapshotOf({ kind: "phrase", phrase: phrase(2, { translation: undefined }) })).toEqual({ text: "Φράση 2." });
    expect(cardSides(phraseCard)).toEqual({ greek: "Φράση 1.", meaning: "Фраза 1." });
    expect(cardKey(wordCard)).toBe(unitKey({ kind: "word", id: "w1" }));
  });

  it("коды облака различны, код снятого вида не занят, незнакомый код не узнаётся", () => {
    const codes = CARD_KINDS.map((kind) => KINDS[kind].code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain("c");
    expect(kindOfCode("w")).toBe("word");
    expect(kindOfCode("p")).toBe("phrase");
    expect(kindOfCode("q")).toBeUndefined();
  });

  it("у каждого вида есть описание хранения", () => {
    for (const kind of CARD_KINDS) expect(STORED_KINDS[kind]).toBeDefined();
  });
});

describe("повторения, которые нельзя спросить", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    await new AppDatabase("tetradio-kinds").delete();
    db = new AppDatabase("tetradio-kinds");
    await db.open();
  });
  afterEach(() => db.close());

  it("фраза со сроком без перевода и голоса уходит в недоступные и не занимает место в занятии", async () => {
    const words = Array.from({ length: SESSION_SIZE }, (_, i) => word(i));
    await db.words.bulkAdd(words.map(indexWord));
    await db.phrases.add(phrase(1, { translation: undefined }));
    await db.cardStates.bulkAdd([dueState("phrase", "p1"), ...words.map((w) => dueState("word", w.id))]);

    const plan = await makePlan(dexieSource(db), now);
    expect(plan.reviews.map((review) => review.ref.id)).not.toContain("p1");
    expect(plan.unavailable).toContainEqual({ kind: "phrase", id: "p1" });
    const session = await makeSession({ source: dexieSource(db), now, random: () => 0.5 });
    expect(session.items).toHaveLength(SESSION_SIZE);
    expect((await db.cardStates.get(unitKey({ kind: "phrase", id: "p1" })))?.version).toBe(1);
  });

  it("карточка исчезающего вида без содержимого не входит в план, её состояние остаётся", async () => {
    const spec = KINDS.phrase;
    spec.vanishes = true;
    try {
      await db.phrases.add(phrase(2));
      await db.cardStates.bulkAdd([dueState("phrase", "p1"), dueState("phrase", "p2")]);
      const plan = await makePlan(dexieSource(db), now);
      expect(plan.reviews.map((review) => review.ref.id)).toEqual(["p2"]);
      expect(plan.unavailable).toEqual([]);
      expect(await db.cardStates.get(unitKey({ kind: "phrase", id: "p1" }))).toBeDefined();
    } finally {
      delete spec.vanishes;
    }
  });
});
