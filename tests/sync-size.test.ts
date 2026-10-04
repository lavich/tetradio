import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import { indexWord, AppDatabase } from "../src/storage/db";
import { buildSnapshot, KEEP_DAYS } from "../src/sync/snapshot";
import { buildContent } from "../content/build";
import { emptySkills, foldSkill, type SkillSummary, type StatsSummary } from "../src/domain/skills";
import { unitKey } from "../src/domain/refs";
import type { BlockProgress, InstalledPackage, LearningRef, LearningState, Lesson, Phrase } from "../src/domain/types";
import { splitParts } from "../src/sync/adapter";
import { decodeSnapshot, encodeSnapshot } from "../src/sync/codec";
import { CLOUD_LIMITS } from "../src/sync/transport";
import type { ExerciseType, ReviewEvent, Word } from "../src/domain/types";
import { installLessons } from "./helpers/content";
import { wordEvent, wordState } from "./helpers/cards";

const TYPES: ExerciseType[] = ["recognition", "assembly", "spelling", "listening"];
const now = new Date("2026-09-16T09:00:00Z");
/** Полная история: у каждого слова по десять ответов каждого типа — верхняя граница сводки навыков. */
async function fill(db: AppDatabase, ids: string[], perType = 10) {
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
const measure = async (db: AppDatabase) => {
  const snapshot = await db.transaction("r", db.tables, () => buildSnapshot(db, now));
  const text = encodeSnapshot(snapshot);
  expect(decodeSnapshot(text)).toEqual(snapshot); // кодек обратим
  return { snapshot, chars: text.length, parts: splitParts(text).length };
};
/** Резерв: текущая версия, новая версия во время публикации и одна конфликтная версия другого устройства плюс указатели двух устройств. */
const keysFor = (parts: number) => parts * 3 + 2;

describe("размер компактного снимка (задача 0.4)", () => {
  it("текущий каталог из четырёх уроков укладывается в единицы частей даже с полной историей навыков", async () => {
    const db = new AppDatabase("tetradio-size-catalog");
    await db.delete();
    await db.open();
    await installLessons(db, ["mech-1", "mech-2", "mech-3", "mech-4"]);
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
      const db = new AppDatabase(`tetradio-size-${total}`);
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

  it("бюджет курса: 2 500 карточек, худшая история и все уроки курса со всеми блоками — не больше 1 024 ключей", async () => {
    const db = new AppDatabase("tetradio-size-course");
    await db.delete();
    await db.open();
    const stamp = now.toISOString();
    // Весь бюджет карточек курса из design.md.
    const refs: LearningRef[] = [
      ...Array.from({ length: 2000 }, (_, index) => ({
        kind: "word" as const,
        id: `w${String(index).padStart(4, "0")}`,
      })),
      ...Array.from({ length: 500 }, (_, index) => ({
        kind: "phrase" as const,
        id: `p-${String(index).padStart(4, "0")}`,
      })),
    ];
    await db.words.bulkAdd(
      refs
        .filter((ref) => ref.kind === "word")
        .map((ref, index) =>
          indexWord({
            id: ref.id,
            greek: `λέξη${index}`,
            russian: `слово${index}`,
            ipa: "",
            segments: [],
            examples: [],
            verified: true,
            createdAt: stamp,
            updatedAt: stamp,
            revision: "r1",
          } satisfies Word),
        ),
    );
    await db.phrases.bulkAdd(
      refs
        .filter((ref) => ref.kind === "phrase")
        .map((ref, index): Phrase => ({
          id: ref.id,
          text: `φράση ${index}`,
          createdAt: stamp,
          updatedAt: stamp,
          revision: "r1",
        })),
    );
    await db.cardStates.bulkPut(
      refs.map((ref, index): LearningState => ({
        unitKey: unitKey(ref),
        ref,
        version: 50,
        introducedAt: new Date(now.getTime() - index * 60000).toISOString(),
        card: {
          ...createEmptyCard(now),
          due: new Date(now.getTime() + index * 3600000),
          reps: 50,
          stability: 12.3456789,
          difficulty: 5.4321,
          scheduled_days: 7,
          elapsed_days: 3,
          state: 2,
          last_review: now,
        },
      })),
    );
    // Худшая история, как выше: по 10 ответов каждого типа у каждой карточки.
    const types: ExerciseType[] = ["recall", "recognition", "assembly", "spelling", "listening"];
    let tick = 0;
    const skills = refs.map((ref) => {
      let summary: SkillSummary = emptySkills();
      for (const type of types)
        for (let index = 0; index < 10; index++)
          summary = foldSkill(summary, {
            type,
            rating: index % 3 ? 3 : 1,
            correct: index % 3 !== 0,
            createdAt: new Date(now.getTime() - 10 ** 8 + tick++ * 1000).toISOString(),
          });
      return { unitKey: unitKey(ref), ref, skills: summary };
    });
    await db.cardSkills.bulkPut(skills);
    // Полное окно статистики: все 14 дней по 300 разных карточек.
    const keys = refs.map(unitKey);
    const stats: StatsSummary = {
      days: Array.from({ length: KEEP_DAYS }, (_, day) => ({
        date: new Date(now.getTime() - (KEEP_DAYS - 1 - day) * 86400000).toISOString().slice(0, 10),
        answers: 900,
        keys: keys.slice((day * 300) % 2200, ((day * 300) % 2200) + 300),
      })),
      recentByType: Object.fromEntries(types.map((type) => [type, Array.from({ length: 10 }, (_, i) => i % 3 !== 0)])),
      answers: refs.length * 50,
      answeredKeys: keys,
    };
    await db.baseSummary.put({ id: "base", asOf: stamp, versionId: "base", stats });
    // С запасом: запись у каждого блока, хотя в приложении её заводят только задания, письмо и речь.
    const course = buildContent("content").packages.filter((pack) => pack.blocks);
    const lesson = (id: string): Lesson => ({
      id,
      courseId: "greek-a2",
      title: id,
      completed: true,
      updatedAt: stamp,
    });
    await db.lessons.bulkPut(course.map((pack) => lesson(pack.id)));
    await db.packages.bulkPut(
      course.map(
        (pack) =>
          ({
            lessonId: pack.id,
            version: "v1",
            schemaVersion: 4,
            installedAt: stamp,
            words: [],
            phrases: [],
            items: [],
            media: [],
            kind: pack.blocks!.some((block) => block.type === "exercise" && block.graded) ? "test" : "lesson",
            module: pack.module,
            blocks: pack.blocks,
          }) as unknown as InstalledPackage,
      ),
    );
    let at = now.getTime() - 10 ** 9;
    const blocks: BlockProgress[] = course.flatMap((pack) =>
      pack.blocks!.map((block) => ({
        key: `${pack.id}/${block.id}`,
        lessonId: pack.id,
        blockId: block.id,
        done: true,
        ...(block.type === "exercise"
          ? { score: { correct: block.items.length - 1, almost: 1, total: block.items.length } }
          : {}),
        ...(block.type === "writing" || block.type === "speaking"
          ? { checks: block.criteria.map((_, index) => index) }
          : {}),
        // Тексты ответов есть локально, но в снимок не идут.
        ...(block.type === "exercise"
          ? { answers: Object.fromEntries(block.items.map((item) => [item.id, "απάντηση"])) }
          : {}),
        ...(block.type === "writing" ? { text: "Γεια σας! ".repeat(20) } : {}),
        updatedAt: new Date((at += 61_000)).toISOString(),
      })),
    );
    await db.blockProgress.bulkPut(blocks);
    const { snapshot, chars, parts } = await measure(db);
    const keysNeeded = keysFor(parts);
    const courseChars = JSON.stringify(JSON.parse(encodeSnapshot(snapshot)).b).length;
    console.log(
      `курс: ${refs.length} карточек, ${course.length} уроков, ${blocks.length} блоков → ${chars} символов ` +
        `(блоки курса ${courseChars}), ${parts} частей, ${keysNeeded} ключей с резервом из ${CLOUD_LIMITS.maxKeys} ` +
        `(запас ${CLOUD_LIMITS.maxKeys - keysNeeded})`,
    );
    // Весь курс, а не фиксированное число: новые уроки входят в бюджет сами.
    expect(course.length).toBeGreaterThanOrEqual(99);
    expect(snapshot.states).toHaveLength(2500);
    expect(snapshot.blocks).toHaveLength(blocks.length);
    expect(snapshot.lessons.filter((item) => item.completed)).toHaveLength(course.length);
    expect(encodeSnapshot(snapshot)).not.toContain("απάντηση");
    expect(keysNeeded).toBeLessThanOrEqual(CLOUD_LIMITS.maxKeys);
    expect(courseChars / blocks.length).toBeLessThan(50);
  }, 60_000);
});
