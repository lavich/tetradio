import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
import { buildContent } from "../content/build";
import { instructionOf } from "../src/domain/item-exercise";
import { makePlan } from "../src/domain/learning";
import { unitKey } from "../src/domain/refs";
import type { LearningRef, LearningState, MistakeItem, SessionItem } from "../src/domain/types";
import { AppDatabase } from "../src/storage/db";
import { exportFull, restoreBackup } from "../src/features/backup/backup";
import { snapshotLabel } from "../src/features/learning/ResultScreen";
import { progress } from "../src/domain/stats";
import { reviewedOn, saveBlockProgress } from "../src/storage/course";
import { STORED_KINDS } from "../src/storage/kinds";
import { dropIgnoredItems, recordAnswer } from "../src/storage/ops";
import { dexieSource } from "../src/storage/queries";
import { decodeSnapshot, encodeSnapshot } from "../src/sync/codec";
import { applySnapshot, buildAndCommitMarked, readSnapshot } from "../src/sync/snapshot";
import { SNAPSHOT_FORMAT, type CompactSnapshot } from "../src/sync/types";
import { installLessons, memoryFetcher } from "./helpers/content";

const demo = buildContent("tests/fixtures/course-demo");
const now = new Date("2026-09-15T09:00:00Z");
const mistake = (id: string): LearningRef => ({ kind: "mistake", id });
const due = (ref: LearningRef, state = State.Learning): LearningState => ({
  unitKey: unitKey(ref),
  ref,
  card: { ...createEmptyCard(new Date("2026-09-14")), due: new Date("2026-09-15T08:00:00Z"), state },
  introducedAt: "2026-09-14T09:00:00Z",
  version: 1,
});
const task = (id: string, over: Partial<MistakeItem> = {}): MistakeItem => ({
  id,
  lessonId: "m01-1",
  format: "choice",
  instruction: "Выберите",
  prompt: "Εγώ ___ η Άννα.",
  options: ["είμαι", "είσαι", "είναι"],
  answer: ["είμαι"],
  ...over,
});
const itemOf = (id: string, over: Partial<SessionItem> = {}): SessionItem => ({
  id: `s-${id}`,
  ref: mistake(id),
  unitKey: unitKey(mistake(id)),
  card: { kind: "mistake", mistake: task(id) },
  type: "item",
  options: ["είμαι", "είσαι", "είναι"],
  isNew: false,
  mode: "scheduled",
  expectedVersion: 1,
  ...over,
});

describe("инструкция пункта урока", () => {
  it("у пропуска и соединения — общая инструкция формата, у ввода — инструкция блока", () => {
    const item = (over: Partial<MistakeItem>) =>
      task("l/b/i", { format: "gap", instruction: "Два слова лишние.", ...over });
    expect(instructionOf(item({}))).toBe("Выберите слово для пропуска");
    expect(instructionOf(item({ format: "match" }))).toBe("Выберите соответствие");
    expect(instructionOf(item({ format: "text" }))).toBe("Два слова лишние.");
  });
});

describe("ошибки уроков не идут в повторение", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    await new AppDatabase("tetradio-mistakes").delete();
    db = new AppDatabase("tetradio-mistakes");
    await db.open();
    await installLessons(db, ["m01-1"], memoryFetcher(demo));
  });
  afterEach(() => db.close());

  it("сохранение блока задания: счёт и ответы без состояний и событий", async () => {
    await saveBlockProgress(
      "m01-1",
      "forms",
      { done: true, answers: { q1: "είσαι" }, score: { correct: 0, almost: 0, total: 1 } },
      db,
      now,
    );
    expect(await db.cardStates.count()).toBe(0);
    expect(await db.events.count()).toBe(0);
    expect((await db.blockProgress.get("m01-1/forms"))!.answers).toEqual({ q1: "είσαι" });
  });

  it("накопленные состояния не входят в план, сроки и группы «Прогресса»", async () => {
    await db.cardStates.bulkAdd([due(mistake("m01-1/forms/q1")), due(mistake("m01-1/forms/gone"))]);
    expect((await makePlan(dexieSource(db), now)).reviews).toEqual([]);
    const stats = await progress(dexieSource(db), now);
    expect(stats.due.today).toBe(0);
    expect(stats.groups.learning).toBe(0);
    expect(await db.cardStates.count()).toBe(2);
  });

  it("источник плана не отдаёт ошибки ни по курсу, ни по набору курсов, ни в ответах за день", async () => {
    const ref = mistake("m01-1/forms/q1");
    await db.cardStates.add(due(ref));
    const at = now.toISOString();
    await db.events.add({
      id: "e1",
      sessionId: "s",
      itemId: "s-0",
      ref,
      unitKey: unitKey(ref),
      snapshot: { prompt: "Вопрос", answer: "ответ" },
      type: "item",
      mode: "scheduled",
      rating: 1,
      correct: false,
      answer: "",
      createdAt: at,
      localDate: "2026-09-15",
      responseTimeMs: 1000,
    });
    const source = dexieSource(db);
    const until = new Date("2026-09-16T00:00:00Z");
    expect(await source.dueStates(until, "greek-a2")).toEqual([]);
    expect([...(await source.dueStatesOf!(until, ["greek-a2"])).values()].flat()).toEqual([]);
    expect(await reviewedOn("2026-09-15", undefined, db)).toBe(0);
  });

  it("вид без содержимого: любое состояние присутствует, пакет не нужен", async () => {
    const stored = STORED_KINDS.mistake;
    expect(await stored.presentIds(["m01-1/forms/q1", "x/y/z"], db)).toEqual(["m01-1/forms/q1", "x/y/z"]);
    expect(await stored.contents(["m01-1/forms/q1"], db)).toEqual([]);
    expect(stored.packageIds({ words: [], phrases: [] })).toEqual([]);
  });

  it("синхронизация с состоянием ошибки: снимок, применение и публикация после ответа", async () => {
    const ref = mistake("m01-1/forms/q1");
    await db.cardStates.add(due(ref));
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

  it("состояние ошибки из облака без установленного пакета ложится в базу и уходит в следующий снимок", async () => {
    const ref = mistake("m01-1/forms/q1");
    await db.cardStates.add(due(ref));
    const snapshot = await readSnapshot(db, now);
    const other = new AppDatabase("tetradio-mistakes-empty");
    await other.delete();
    await other.open();
    try {
      expect(await applySnapshot(other, snapshot, "remote-1", { remote: 1 }, now)).toBe(true);
      expect(await other.cardStates.get(unitKey(ref))).toBeDefined();
      expect(await other.cardStash.count()).toBe(0);
      expect((await readSnapshot(other, now)).states.map((state) => state.ref)).toContainEqual(ref);
    } finally {
      other.close();
      await other.delete();
    }
  });

  it("отложенное состояние ошибки не теряется: уходит в следующий снимок", async () => {
    const ref = mistake("m01-1/forms/q1");
    await db.cardStates.add(due(ref));
    const snapshot = await readSnapshot(db, now);
    const stashed = snapshot.states.find((state) => "kind" in state.ref && state.ref.kind === "mistake")!;
    const other = new AppDatabase("tetradio-mistakes-stash");
    await other.delete();
    await other.open();
    try {
      await other.cardStash.put({ unitKey: unitKey(ref), ref, state: stashed });
      expect((await readSnapshot(other, now)).states.map((state) => state.ref)).toContainEqual(ref);
    } finally {
      other.close();
      await other.delete();
    }
  });

  it("ответ в занятии прежней версии с заданием урока записывается без дополнительной попытки", async () => {
    const first = itemOf("m01-1/forms/q1");
    const session = {
      id: "s",
      createdAt: now.toISOString(),
      planDate: "2026-09-15",
      items: [first, itemOf("m01-1/forms/q2")],
      index: 0,
      status: "active" as const,
      activeTimeMs: 0,
    };
    await db.cardStates.add(due(first.ref));
    await db.sessions.put(session);
    await recordAnswer({
      session,
      item: first,
      correct: false,
      answer: "είσαι",
      responseTimeMs: 2000,
      activeTimeMs: 2000,
      timezone: "UTC",
      now,
      database: db,
    });
    expect((await db.sessions.get("s"))!.items.map((entry) => entry.id)).toEqual([first.id, "s-m01-1/forms/q2"]);
  });
});

describe("занятие, начатое до обновления", () => {
  let db: AppDatabase;
  beforeEach(async () => {
    await new AppDatabase("tetradio-mistakes-sessions").delete();
    db = new AppDatabase("tetradio-mistakes-sessions");
    await db.open();
  });
  afterEach(() => db.close());
  const word = (id: string, over: Partial<SessionItem> = {}): SessionItem => ({
    ...itemOf(id),
    id: `s-${id}`,
    ref: { kind: "word", id },
    unitKey: unitKey({ kind: "word", id }),
    card: { kind: "word", word: { id } as never },
    type: "recognition",
    ...over,
  });
  const put = (id: string, items: SessionItem[], status: "active" | "done" | "ended" = "active") =>
    db.sessions.put({
      id,
      createdAt: now.toISOString(),
      planDate: "2026-09-15",
      items,
      index: 0,
      status,
      activeTimeMs: 0,
    });

  it("невыполненные ошибки уходят, слова и отвеченные остаются, позиция пересчитана", async () => {
    await put("mixed", [
      word("w1", { eventId: "e1" }),
      itemOf("l/b/q1", { eventId: "e2" }),
      itemOf("l/b/q2"),
      itemOf("l/b/q3", { skipped: true }),
      word("w2"),
    ]);
    await dropIgnoredItems(db);
    const stored = (await db.sessions.get("mixed"))!;
    expect(stored.items.map((item) => item.id)).toEqual(["s-w1", "s-l/b/q1", "s-l/b/q3", "s-w2"]);
    expect(stored.index).toBe(3);
    expect(stored.status).toBe("active");
  });

  it("остались одни отвеченные — занятие завершено; не осталось ничего — закрыто", async () => {
    await put("answered", [word("w1", { eventId: "e1" }), itemOf("l/b/q2")]);
    await put("only", [itemOf("l/b/q1"), itemOf("l/b/q2")]);
    await dropIgnoredItems(db);
    expect((await db.sessions.get("answered"))!.status).toBe("done");
    expect(await db.sessions.get("only")).toMatchObject({ status: "ended", items: [], index: 0 });
  });

  it("завершённое занятие и повторный вызов ничего не меняют", async () => {
    await put("done", [itemOf("l/b/q1", { eventId: "e1" }), itemOf("l/b/q2")], "done");
    await put("clean", [word("w1"), word("w2")]);
    const before = await db.sessions.toArray();
    await dropIgnoredItems(db);
    await dropIgnoredItems(db);
    expect(await db.sessions.toArray()).toEqual(before);
  });
});

describe("ошибки в копии", () => {
  it("полная копия переносит состояния ошибок", async () => {
    const source = new AppDatabase("tetradio-mistakes-copy");
    await source.delete();
    await source.open();
    await installLessons(source, ["m01-1"], memoryFetcher(demo));
    await source.cardStates.add(due(mistake("m01-1/forms/q1")));
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
