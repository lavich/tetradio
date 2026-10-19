import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import { indexWord, AppDatabase } from "../src/storage/db";
import { buildSnapshot, KEEP_DAYS } from "../src/sync/snapshot";
import { emptySkills, foldSkill, type SkillSummary, type StatsSummary } from "../src/domain/skills";
import { unitKey } from "../src/domain/refs";
import type { BlockProgress, InstalledPackage, LearningRef, LearningState, Lesson, Phrase } from "../src/domain/types";
import type { CompactSnapshot } from "../src/sync/types";
import { splitParts } from "../src/sync/adapter";
import { decodeSnapshot, encodeSnapshot, packSnapshot, unpackSnapshot } from "../src/sync/codec";
import { CLOUD_LIMITS } from "../src/sync/transport";
import type { ExerciseType, ReviewEvent, Word } from "../src/domain/types";
import { installLessons } from "./helpers/content";
import { realContent } from "./helpers/real-content";
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
  const text = encodeSnapshot(snapshot, 5);
  expect(decodeSnapshot(text)).toEqual(snapshot); // кодек обратим
  return { snapshot, chars: text.length, parts: splitParts(text).length };
};
/** Формат 6 — тот же JSON, упакованный deflate и base64; части считаются по упакованному тексту. */
const packed = (snapshot: CompactSnapshot) => {
  const json = encodeSnapshot(snapshot, 6);
  const text = packSnapshot(json);
  expect(unpackSnapshot(text)).toBe(json);
  return { chars: text.length, parts: splitParts(text).length };
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

  it("бюджет курса: 2 500 карточек, 1 000 ошибок уроков, худшая история и все уроки курса со всеми блоками — не больше 1 024 ключей", async () => {
    const { db, snapshot, refs, mistakes, lessons, blocks } = await fillCourse("tetradio-size-course", {
      cards: 2500,
      mistakes: 1000,
    });
    const { chars, parts } = await measure(db);
    const keysNeeded = keysFor(parts);
    const courseChars = JSON.stringify(JSON.parse(encodeSnapshot(snapshot)).b).length;
    const six = packed(snapshot);
    console.log(
      `курс: ${refs.length} карточек и ${mistakes.length} ошибок, ${lessons} уроков, ${blocks} блоков → ${chars} символов ` +
        `(блоки курса ${courseChars}), ${parts} частей, ${keysNeeded} ключей с резервом из ${CLOUD_LIMITS.maxKeys} ` +
        `(запас ${CLOUD_LIMITS.maxKeys - keysNeeded}); формат 6 — ${six.chars} символов, ${six.parts} частей, ` +
        `${keysFor(six.parts)} ключей`,
    );
    // Весь курс, а не фиксированное число: новые уроки входят в бюджет сами.
    expect(lessons).toBeGreaterThanOrEqual(99);
    expect(snapshot.states).toHaveLength(3500);
    expect(snapshot.blocks).toHaveLength(blocks);
    expect(snapshot.lessons.filter((item) => item.completed)).toHaveLength(lessons);
    expect(encodeSnapshot(snapshot)).not.toContain("απάντηση");
    expect(keysNeeded).toBeLessThanOrEqual(CLOUD_LIMITS.maxKeys);
    expect(courseChars / blocks).toBeLessThan(50);
  }, 60_000);
});

describe("вместимость формата 6: все курсы бота на правдоподобной истории", () => {
  const rows: Record<string, { chars5: number; parts5: number; chars6: number; parts6: number }> = {};
  const measureBudget = async (name: string, budget: Budget) => {
    const { db, snapshot, refs, mistakes, lessons, blocks } = await fillCourse(name, { ...budget, plausible: true });
    const five = await measure(db);
    const six = packed(snapshot);
    expect(refs.length).toBe(budget.cards);
    expect(mistakes.length).toBe(budget.mistakes);
    expect(lessons).toBe(budget.lessons);
    expect(snapshot.states).toHaveLength(budget.cards + budget.mistakes);
    console.log(
      `${name}: ${refs.length} карточек, ${mistakes.length} ошибок, ${lessons} уроков, ${blocks} блоков → ` +
        `формат 5: ${five.chars} символов, ${five.parts} частей, ${keysFor(five.parts)} ключей; ` +
        `формат 6: ${six.chars} символов, ${six.parts} частей, ${keysFor(six.parts)} ключей с резервом`,
    );
    return { chars5: five.chars, parts5: five.parts, chars6: six.chars, parts6: six.parts };
  };

  it("три курса: 2 630 карточек, 2 070 ошибок, 207 уроков — не больше 1 024 ключей с резервом", async () => {
    rows.three = await measureBudget("три курса", { cards: 2630, mistakes: 2070, lessons: 207 });
    expect(keysFor(rows.three.parts6)).toBeLessThanOrEqual(CLOUD_LIMITS.maxKeys);
  }, 120_000);
  it("запас: 4 000 карточек, 3 000 ошибок, 300 уроков — не больше 1 024 ключей с резервом", async () => {
    rows.reserve = await measureBudget("запас", { cards: 4000, mistakes: 3000, lessons: 300 });
    expect(keysFor(rows.reserve.parts6)).toBeLessThanOrEqual(CLOUD_LIMITS.maxKeys);
  }, 120_000);
  it("переход: версия формата 5 трёх курсов, две версии формата 6 и два указателя — не больше 1 024 ключей", () => {
    expect(rows.three).toBeDefined();
    const keys = rows.three.parts5 + 2 * rows.three.parts6 + 2;
    console.log(`переход: ${rows.three.parts5} + 2 × ${rows.three.parts6} + 2 = ${keys} ключей`);
    expect(keys).toBeLessThanOrEqual(CLOUD_LIMITS.maxKeys);
  });
});

interface Budget {
  cards: number;
  mistakes: number;
  lessons?: number;
  plausible?: boolean;
}
/** Детерминированный ГПСЧ mulberry32: размер упаковки зависит от данных, и прогоны должны совпадать. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** `ts-fsrs` хранит стабильность и сложность с восемью знаками: так их и видит сжатие. */
const round8 = (value: number) => Number(value.toFixed(8));
const DAY = 86_400_000;

/**
 * Курс с полной историей: 80 % карточек — слова, ошибки уроков — настоящие пункты курса, все уроки пройдены,
 * запись у каждого блока. Уроков больше, чем в греческом курсе, — копии его уроков с другими id.
 * `plausible` — разброс чисел FSRS, сроков, дат и исходов (75 % верных): шум сжимается хуже всего.
 */
async function fillCourse(name: string, { cards, mistakes: mistakeCount, lessons: lessonCount, plausible }: Budget) {
  const random = seeded(145);
  const db = new AppDatabase(name);
  await db.delete();
  await db.open();
  const stamp = now.toISOString();
  const wordCount = Math.round(cards * 0.8);
  const refs: LearningRef[] = [
    ...Array.from({ length: wordCount }, (_, index) => ({
      kind: "word" as const,
      id: `w${String(index).padStart(4, "0")}`,
    })),
    ...Array.from({ length: cards - wordCount }, (_, index) => ({
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
  const greek = realContent().packages.filter((pack) => pack.blocks);
  const course = Array.from({ length: lessonCount ?? greek.length }, (_, index) => {
    const pack = greek[index % greek.length];
    const copy = Math.floor(index / greek.length);
    return { ...pack, id: copy ? `${pack.id}-${copy}` : pack.id };
  });
  // Ошибки уроков с идентификаторами настоящих пунктов курса: они в разы длиннее `w0001`.
  const mistakes: LearningRef[] = course
    .flatMap((pack) =>
      pack.blocks!.flatMap((block) =>
        block.type === "exercise" && !block.about ? block.items.map((item) => `${pack.id}/${block.id}/${item.id}`) : [],
      ),
    )
    .slice(0, mistakeCount)
    .map((id) => ({ kind: "mistake" as const, id }));
  const all = [...refs, ...mistakes];
  const pastMs = () => now.getTime() - Math.floor(random() * 180 * DAY);
  await db.cardStates.bulkPut(
    all.map((ref, index): LearningState => ({
      unitKey: unitKey(ref),
      ref,
      version: 50,
      introducedAt: new Date(plausible ? pastMs() : now.getTime() - index * 60000).toISOString(),
      card: plausible
        ? {
            ...createEmptyCard(now),
            due: new Date(now.getTime() + Math.floor(random() * 90 * DAY)),
            reps: 1 + Math.floor(random() * 60),
            lapses: Math.floor(random() * 6),
            stability: round8(0.1 + random() * 120),
            difficulty: round8(1 + random() * 9),
            scheduled_days: Math.floor(random() * 90),
            elapsed_days: Math.floor(random() * 30),
            state: 2,
            last_review: new Date(pastMs()),
          }
        : {
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
  // Худшая история: по 10 ответов каждого типа у каждой карточки.
  const types: ExerciseType[] = ["recall", "recognition", "assembly", "spelling", "listening"];
  let tick = 0;
  const skills = all.map((ref) => {
    let summary: SkillSummary = emptySkills();
    const times = plausible
      ? Array.from({ length: 50 }, pastMs).sort((a, b) => a - b)
      : Array.from({ length: 50 }, () => now.getTime() - 10 ** 8 + tick * 1000);
    let step = 0;
    for (const type of ref.kind === "mistake" ? (["item"] as const) : types)
      for (let index = 0; index < 10; index++) {
        const correct = plausible ? random() < 0.75 : index % 3 !== 0;
        summary = foldSkill(summary, {
          type,
          itemId: `i-${tick++}`,
          rating: correct ? 3 : 1,
          correct,
          createdAt: new Date(plausible ? times[step++] : times[0] + step++ * 1000).toISOString(),
        });
      }
    return { unitKey: unitKey(ref), ref, skills: summary };
  });
  await db.cardSkills.bulkPut(skills);
  // Полное окно статистики: все 14 дней по 300 разных карточек.
  const keys = refs.map(unitKey);
  const stats: StatsSummary = {
    days: Array.from({ length: KEEP_DAYS }, (_, day) => {
      const start = plausible ? Math.floor(random() * (keys.length - 300)) : (day * 300) % 2200;
      return {
        date: new Date(now.getTime() - (KEEP_DAYS - 1 - day) * DAY).toISOString().slice(0, 10),
        answers: plausible ? 300 + Math.floor(random() * 900) : 900,
        keys: keys.slice(start, start + 300),
      };
    }),
    recentByType: Object.fromEntries(
      types.map((type) => [type, Array.from({ length: 10 }, (_, i) => (plausible ? random() < 0.75 : i % 3 !== 0))]),
    ),
    answers: refs.length * 50,
    answeredKeys: keys,
  };
  await db.baseSummary.put({ id: "base", asOf: stamp, versionId: "base", stats });
  // С запасом: запись у каждого блока, хотя в приложении её заводят только задания, письмо и речь.
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
      updatedAt: new Date(plausible ? pastMs() : (at += 61_000)).toISOString(),
    })),
  );
  await db.blockProgress.bulkPut(blocks);
  const snapshot = await db.transaction("r", db.tables, () => buildSnapshot(db, now));
  return { db, snapshot, refs, mistakes, lessons: course.length, blocks: blocks.length };
}
