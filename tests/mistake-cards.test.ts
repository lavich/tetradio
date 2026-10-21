import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
import { buildContent } from "../content/build";
import type { ExerciseBlock } from "../src/content/course";
import { mistakesOf, scoreExercise } from "../src/domain/course";
import { itemExercise, instructionOf } from "../src/domain/item-exercise";
import { makePlan } from "../src/domain/learning";
import { shareReviews } from "../src/domain/session";
import { unitKey } from "../src/domain/refs";
import type { LearningRef, LearningState, MistakeItem } from "../src/domain/types";
import { AppDatabase } from "../src/storage/db";
import { exportFull, restoreBackup } from "../src/features/backup/backup";
import { snapshotLabel } from "../src/features/learning/ResultScreen";
import { progress } from "../src/domain/stats";
import { lessonMistakes, saveBlockProgress } from "../src/storage/course";
import { cardCourses } from "../src/storage/courses";
import { STORED_KINDS } from "../src/storage/kinds";
import { recordAnswer } from "../src/storage/ops";
import { dexieSource, mistakeCount } from "../src/storage/queries";
import { decodeSnapshot, encodeSnapshot } from "../src/sync/codec";
import { applySnapshot, buildAndCommitMarked, readSnapshot } from "../src/sync/snapshot";
import { SNAPSHOT_FORMAT, type CompactSnapshot } from "../src/sync/types";
import { installLessons, memoryFetcher } from "./helpers/content";

const demo = buildContent("tests/fixtures/course-demo");
const pack = demo.packages.find((p) => p.id === "m01-1")!;
const block = (id: string) => pack.blocks!.find((b) => b.id === id)! as ExerciseBlock;
const now = new Date("2026-09-15T09:00:00Z");
const mistake = (id: string): LearningRef => ({ kind: "mistake", id });
const due = (ref: LearningRef, state = State.Learning): LearningState => ({
  unitKey: unitKey(ref),
  ref,
  card: { ...createEmptyCard(new Date("2026-09-14")), due: new Date("2026-09-15T08:00:00Z"), state },
  introducedAt: "2026-09-14T09:00:00Z",
  version: 1,
});

describe("отбор пунктов для карточек ошибок", () => {
  it("неверный непустой ответ даёт карточку, «почти», пустой ответ и задание к тексту — нет", () => {
    const forms = block("forms");
    const answers = { q1: "είσαι" };
    expect(mistakesOf(forms, answers, scoreExercise(forms, answers))).toEqual(["q1"]);
    expect(mistakesOf(forms, {}, scoreExercise(forms, {}))).toEqual([]);
    const cafe = block("cafe-q");
    const wrong = { q1: "Άννα", q2: "Ρωσία" };
    expect(mistakesOf(cafe, wrong, scoreExercise(cafe, wrong))).toEqual([]);
    const free = { ...cafe, about: undefined };
    const almost = { q1: "Μαρια", q2: "Ρωσία" };
    expect(mistakesOf(free, almost, scoreExercise(free, almost))).toEqual(["q2"]);
  });
  it("оценивается ли пункт в контрольной, на отбор не влияет", () => {
    const forms = block("forms");
    const answers = { q1: "είσαι" };
    expect(mistakesOf({ ...forms, graded: true }, answers, scoreExercise(forms, answers))).toEqual(["q1"]);
  });
});

describe("упражнение пункта урока", () => {
  const item = (over: Partial<MistakeItem>): MistakeItem => ({
    id: "l/b/i",
    lessonId: "l",
    format: "gap",
    instruction: "Два слова лишние.",
    prompt: "Εγώ ___ η Άννα.",
    answer: ["είμαι"],
    ...over,
  });
  it("ввод остаётся вводом, выбор показывает варианты пункта", () => {
    expect(itemExercise(item({ format: "text" }), () => 0.5)).toEqual({ type: "item", options: [] });
    const choice = itemExercise(item({ format: "choice", options: ["είμαι", "είσαι", "είναι"] }), () => 0.5);
    expect(choice.options.sort()).toEqual(["είμαι", "είναι", "είσαι"]);
  });
  it("два варианта выбора идут в порядке урока", () => {
    expect(itemExercise(item({ format: "choice", options: ["Σωστό", "Λάθος"] }), () => 0.9).options).toEqual([
      "Σωστό",
      "Λάθος",
    ]);
  });
  it("пропуск: ответ и три других значения банка без повтора ответа; при маленьком банке — все", () => {
    const options = itemExercise(
      item({ options: ["είμαι", "είσαι", "είμαι", "είναι", "είμαστε", "είστε"] }),
      () => 0.3,
    ).options;
    expect(options).toHaveLength(4);
    expect(options.filter((option) => option === "είμαι")).toHaveLength(1);
    expect(new Set(options).size).toBe(4);
    expect(itemExercise(item({ options: ["είμαι", "είσαι"] }), () => 0.3).options.sort()).toEqual(["είμαι", "είσαι"]);
  });
  it("у пропуска и соединения — общая инструкция формата, у ввода и выбора — инструкция блока", () => {
    expect(instructionOf(item({}))).toBe("Выберите слово для пропуска");
    expect(instructionOf(item({ format: "match" }))).toBe("Выберите соответствие");
    expect(instructionOf(item({ format: "text" }))).toBe("Два слова лишние.");
  });
});

describe("доля ошибок в занятии", () => {
  it("ошибки занимают не больше половины мест, пока есть другие повторения; без них — снова ошибки", () => {
    const reviews = [
      ...Array.from({ length: 20 }, (_, i) => ({ ref: mistake(`l/b/q${i}`) })),
      ...Array.from({ length: 15 }, (_, i) => ({ ref: { kind: "word" as const, id: `w${i}` } })),
    ];
    const taken = shareReviews(reviews, 10);
    expect(taken).toHaveLength(10);
    expect(taken.filter((review) => review.ref.kind === "mistake")).toHaveLength(5);
    const only = shareReviews(reviews.slice(0, 20), 10);
    expect(only.filter((review) => review.ref.kind === "mistake")).toHaveLength(10);
  });
});

describe("карточки ошибок в базе", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    await new AppDatabase("tetradio-mistakes").delete();
    db = new AppDatabase("tetradio-mistakes");
    await db.open();
    await installLessons(db, ["m01-1"], memoryFetcher(demo));
  });
  afterEach(() => db.close());

  it("проверка задания создаёт карточку «снова» без события; повторная ошибка срок не меняет", async () => {
    await saveBlockProgress("m01-1", "forms", { done: true, answers: { q1: "είσαι" }, mistakes: ["q1"] }, db, now);
    const key = unitKey(mistake("m01-1/forms/q1"));
    const state = (await db.cardStates.get(key))!;
    expect(state.card.state).toBe(State.Learning);
    expect(new Date(state.card.due).getTime() - now.getTime()).toBeLessThan(15 * 60_000);
    expect(await db.events.count()).toBe(0);
    expect((await db.blockProgress.get("m01-1/forms"))!).not.toHaveProperty("mistakes");
    await saveBlockProgress(
      "m01-1",
      "forms",
      { done: true, answers: { q1: "είναι" }, mistakes: ["q1"] },
      db,
      new Date(now.getTime() + 60_000),
    );
    expect((await db.cardStates.get(key))!.version).toBe(state.version);
    expect(await lessonMistakes("m01-1", db)).toBe(1);
  });

  it("синхронизация с карточкой ошибки: снимок, применение и публикация после ответа", async () => {
    await saveBlockProgress("m01-1", "forms", { done: true, answers: { q1: "είσαι" }, mistakes: ["q1"] }, db, now);
    const ref = mistake("m01-1/forms/q1");
    const snapshot = await readSnapshot(db, now);
    expect(snapshot.states.map((state) => state.ref)).toContainEqual(ref);
    expect(await applySnapshot(db, snapshot, "remote-1", { remote: 1 }, now)).toBe(true);
    expect(await db.cardStates.get(unitKey(ref))).toBeDefined();
    const at = new Date(now.getTime() + 120_000).toISOString();
    await db.events.add({
      id: "e-mistake",
      sessionId: "s",
      itemId: "s-0",
      ref,
      unitKey: unitKey(ref),
      snapshot: { prompt: "Εγώ ___ η Άννα.", answer: "είμαι" },
      type: "item",
      mode: "scheduled",
      rating: 3,
      correct: true,
      answer: "είμαι",
      createdAt: at,
      localDate: at.slice(0, 10),
      responseTimeMs: 2000,
    });
    const { snapshot: published } = await buildAndCommitMarked(db, new Date(now.getTime() + 180_000), "local-2");
    expect(
      published.skills.find((entry) => unitKey(entry.ref as LearningRef) === unitKey(ref))?.skills.types.item?.recent,
    ).toEqual([true]);
  });

  it("неверный ответ на пункт урока не возвращает его в том же занятии", async () => {
    await saveBlockProgress("m01-1", "forms", { done: true, answers: { q1: "είσαι" }, mistakes: ["q1"] }, db, now);
    const ref = mistake("m01-1/forms/q1");
    const [card] = await STORED_KINDS.mistake.contents([ref.id], db);
    const state = (await db.cardStates.get(unitKey(ref)))!;
    const item = {
      id: "s-0",
      ref,
      unitKey: unitKey(ref),
      card,
      type: "item" as const,
      options: ["είμαι", "είσαι", "είναι"],
      isNew: false,
      mode: "scheduled" as const,
      expectedVersion: state.version,
    };
    const session = {
      id: "s",
      createdAt: now.toISOString(),
      planDate: "2026-09-15",
      items: [
        item,
        { ...item, id: "s-1", ref: mistake("m01-1/forms/q2"), unitKey: unitKey(mistake("m01-1/forms/q2")) },
      ],
      index: 0,
      status: "active" as const,
      activeTimeMs: 0,
    };
    await db.sessions.put(session);
    await recordAnswer({
      session,
      item,
      correct: false,
      answer: "είσαι",
      responseTimeMs: 2000,
      activeTimeMs: 2000,
      timezone: "UTC",
      now,
      database: db,
    });
    expect((await db.sessions.get("s"))!.items.map((entry) => entry.id)).toEqual(["s-0", "s-1"]);
  });

  it("содержимое — пункт из пакета; задание к тексту и убранный пункт спросить нельзя", async () => {
    const stored = STORED_KINDS.mistake;
    expect(await stored.presentIds(["m01-1/forms/q1", "m01-1/anna-tf/q1", "m01-1/forms/gone"], db)).toEqual([
      "m01-1/forms/q1",
    ]);
    const [card] = await stored.contents(["m01-1/forms/q1"], db);
    expect(card).toMatchObject({
      kind: "mistake",
      mistake: { format: "choice", prompt: "Εγώ ___ η Άννα.", answer: ["είμαι"], options: ["είμαι", "είσαι", "είναι"] },
    });
  });

  it("убранный пункт не считается ни в итоге урока, ни в сроках и группах «Прогресса»", async () => {
    await db.cardStates.bulkAdd([due(mistake("m01-1/forms/q1")), due(mistake("m01-1/forms/gone"))]);
    expect(await lessonMistakes("m01-1", db)).toBe(1);
    const stats = await progress(dexieSource(db), now);
    expect(stats.due.today).toBe(1);
    expect(stats.groups.learning).toBe(1);
  });

  it("план берёт ошибку в повторения, убранный пункт — нет; курс ошибки — курс её урока", async () => {
    await db.cardStates.bulkAdd([due(mistake("m01-1/forms/q1")), due(mistake("m01-1/forms/gone"))]);
    const plan = await makePlan(dexieSource(db), now);
    expect(plan.reviews.map((review) => review.ref.id)).toEqual(["m01-1/forms/q1"]);
    const owner = (await db.lessons.get("m01-1"))!.courseId ?? (await db.catalog.get("m01-1"))!.courseId;
    expect((await cardCourses([unitKey(mistake("m01-1/forms/q1"))], db)).get(unitKey(mistake("m01-1/forms/q1")))).toBe(
      owner,
    );
    expect(await mistakeCount(owner, db)).toBe(1);
    expect(await mistakeCount("other-course", db)).toBe(0);
    expect(await mistakeCount([owner, "other-course"], db)).toBe(1);
    expect(await mistakeCount(["other-course"], db)).toBe(0);
  });
});

describe("ошибки в копии", () => {
  it("полная копия переносит карточки ошибок", async () => {
    const source = new AppDatabase("tetradio-mistakes-copy");
    await source.delete();
    await source.open();
    await installLessons(source, ["m01-1"], memoryFetcher(demo));
    await saveBlockProgress("m01-1", "forms", { done: true, answers: { q1: "είσαι" }, mistakes: ["q1"] }, source, now);
    const parsed = JSON.parse(await (await exportFull(source)).text());
    const copy = new Blob([JSON.stringify({ ...parsed, data: { ...parsed.data, databaseName: "tetradio" } })], {
      type: "application/json",
    });
    const target = new AppDatabase("tetradio-mistakes-restored");
    await target.delete();
    await target.open();
    try {
      await restoreBackup(copy, target);
      expect(await target.cardStates.get(unitKey(mistake("m01-1/forms/q1")))).toBeDefined();
    } finally {
      source.close();
      target.close();
      await source.delete();
      await target.delete();
    }
  });
});

describe("ошибки в облаке", () => {
  it("вид `e` и тип `i` проходят круг формата 5", () => {
    const ref = mistake("m01-1/forms/q1");
    const snapshot: CompactSnapshot = {
      format: SNAPSHOT_FORMAT,
      createdAt: now.toISOString(),
      lessons: [],
      packages: [],
      blocks: [],
      states: [
        {
          ref,
          card: { ...createEmptyCard(now), due: now.toISOString(), last_review: undefined },
          introducedAt: now.toISOString(),
          version: 1,
        },
      ],
      skills: [
        {
          ref,
          skills: {
            types: { item: { recent: [false, true], lastAt: now.toISOString() } },
            lastTypes: ["item" as const],
            cleanAssemblies: 0,
          },
        },
      ],
      stats: { days: [], recentByType: { item: [true] }, answers: 1, answeredKeys: [unitKey(ref)] },
    };
    const text = encodeSnapshot(snapshot);
    expect(text).toContain('"em01-1/forms/q1"');
    const decoded = decodeSnapshot(text);
    expect(decoded.states[0].ref).toEqual(ref);
    expect(decoded.skills[0].skills.types.item?.recent).toEqual([false, true]);
    expect(decoded.stats.recentByType.item).toEqual([true]);
  });
});

describe("подпись в итоге занятия", () => {
  it("у задания урока — его вопрос", () => {
    expect(snapshotLabel({ snapshot: { prompt: "Εγώ ___ η Άννα.", answer: "είμαι" } })).toBe("Εγώ ___ η Άννα.");
    expect(snapshotLabel({ snapshot: { greek: "η λέξη", russian: "слово" } })).toBe("η λέξη");
  });
});
