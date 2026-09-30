import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import { indexWord, LexiDatabase } from "../src/storage/db";
import { buildSnapshot } from "../src/sync/snapshot";
import { splitParts } from "../src/sync/adapter";
import { decodeSnapshot, encodeSnapshot } from "../src/sync/codec";
import { CLOUD_LIMITS } from "../src/sync/transport";
import type { ExerciseType, ReviewEvent, Word } from "../src/domain/types";
import { installLessons } from "./helpers/content";
import { wordEvent, wordState } from "./helpers/cards";

const TYPES: ExerciseType[] = ["recognition", "assembly", "spelling", "listening"];
const now = new Date("2026-09-16T09:00:00Z");
/** Полная история: у каждого слова по десять ответов каждого типа — верхняя граница сводки навыков. */
async function fill(db: LexiDatabase, ids: string[], perType = 10) {
  const states = ids.map((wordId, index) =>
    wordState(wordId, {
      version: perType * TYPES.length,
      introducedAt: new Date(now.getTime() - index * 60000).toISOString(),
      card: {
        ...createEmptyCard(now),
        due: new Date(now.getTime() + index * 3600000),
        reps: perType * TYPES.length,
        stability: 12.3456789,
        difficulty: 5.4321,
        scheduled_days: 7,
        elapsed_days: 3,
        state: 2,
        last_review: now,
      },
    }),
  );
  await db.cardStates.bulkPut(states);
  const events: ReviewEvent[] = [];
  let tick = 0;
  for (const wordId of ids)
    for (const type of TYPES)
      for (let index = 0; index < perType; index++) {
        const at = new Date(now.getTime() - 10 ** 7 + tick++ * 1000).toISOString();
        events.push(
          wordEvent(wordId, {
            id: `e-${wordId}-${type}-${index}`,
            sessionId: "s",
            itemId: `i-${tick}`,
            snapshot: { greek: "", russian: "" },
            type,
            mode: "scheduled",
            rating: index % 3 ? 3 : 1,
            correct: index % 3 !== 0,
            answer: "",
            createdAt: at,
            localDate: at.slice(0, 10),
            responseTimeMs: 900,
          }),
        );
      }
  await db.events.bulkPut(events);
}
const measure = async (db: LexiDatabase) => {
  const snapshot = await db.transaction("r", db.tables, () => buildSnapshot(db, now));
  const text = encodeSnapshot(snapshot);
  expect(decodeSnapshot(text)).toEqual(snapshot); // кодек обратим
  return { snapshot, chars: text.length, parts: splitParts(text).length };
};
/** Резерв: текущая версия, новая версия во время публикации и одна конфликтная версия другого устройства плюс указатели двух устройств. */
const keysFor = (parts: number) => parts * 3 + 2;

describe("размер компактного снимка (задача 0.4)", () => {
  it("текущий каталог из четырёх уроков укладывается в единицы частей даже с полной историей навыков", async () => {
    const db = new LexiDatabase("lexi-size-catalog");
    await db.delete();
    await db.open();
    await installLessons(db, ["lesson-1-1", "lesson-1-2", "lesson-1-3", "lesson-1-4"]);
    const ids = (await db.words.toArray()).map((word) => word.id);
    await fill(db, ids);
    const { snapshot, chars, parts } = await measure(db);
    console.log(`каталог: ${ids.length} слов, ${chars} символов, ${parts} частей, ${keysFor(parts)} ключей с резервом`);
    expect(snapshot.states).toHaveLength(ids.length);
    expect(snapshot.skills).toHaveLength(ids.length);
    // Потолок — ключи облака, а не число частей: расти каталогу можно, выходить за лимит переноса — нет.
    expect(keysFor(parts)).toBeLessThan(CLOUD_LIMITS.maxKeys);
    // Цена одного слова с полной историей навыков: сводка, а не список ответов.
    expect(chars / ids.length).toBeLessThan(320);
  });
  it("растущий набор: границы вместимости с резервом на две версии и конфликт", async () => {
    const results: { words: number; chars: number; parts: number; keys: number }[] = [];
    for (const total of [500, 1000, 2000]) {
      const db = new LexiDatabase(`lexi-size-${total}`);
      await db.delete();
      await db.open();
      const words: Word[] = Array.from({ length: total }, (_, index) => ({
        id: `w99-${String(index).padStart(4, "0")}`,
        greek: `λέξη${index}`,
        russian: `слово${index}`,
        ipa: "",
        segments: [],
        examples: [],
        verified: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        revision: "r1",
      }));
      await db.words.bulkAdd(words.map(indexWord));
      await fill(
        db,
        words.map((word) => word.id),
        3,
      );
      const { chars, parts } = await measure(db);
      results.push({ words: total, chars, parts, keys: keysFor(parts) });
    }
    console.log("растущий набор:", JSON.stringify(results));
    const perWord = results[2].chars / results[2].words;
    const capacity = Math.floor((((CLOUD_LIMITS.maxKeys - 2) / 3) * 4000) / perWord);
    console.log(
      `≈${Math.round(perWord)} символов на слово → предел ≈${capacity} стандартных слов при трёх версиях в облаке`,
    );
    expect(results.every((result) => result.keys < CLOUD_LIMITS.maxKeys)).toBe(true);
    expect(capacity).toBeGreaterThan(3000);
  }, 60_000); // три базы по тысячам событий: на CI-раннере дольше стандартных 5 секунд
});
