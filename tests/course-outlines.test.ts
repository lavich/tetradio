import "fake-indexeddb/auto";
import { liveQuery } from "dexie";
import { Rating } from "ts-fsrs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { applyPackage } from "../src/content/client";
import { makeSession, nextState } from "../src/domain/learning";
import { moduleViews, saveBlockProgress, type ModuleView } from "../src/storage/course";
import { AppDatabase } from "../src/storage/db";
import { STORED_KINDS } from "../src/storage/kinds";
import { submitAnswer } from "../src/storage/ops";
import { courseProgress, type CourseProgress } from "../src/storage/progress";
import { dexieSource, mistakeCount } from "../src/storage/queries";
import { completeLessons, installLessons, memoryFetcher } from "./helpers/content";

const demo = buildContent("tests/fixtures/course-demo");
const now = new Date("2026-09-15T09:00:00Z");
const tz = "Asia/Nicosia";
const LESSONS = ["m01-1", "m01-test", "m01-k1", "m01-r1"];

/** Сколько записей пакетов прочитано: живые запросы не должны тянуть пакеты, пока те не менялись. */
function countPackageReads(database: AppDatabase) {
  const reads = { rows: 0 };
  database.use({
    stack: "dbcore",
    name: "package-reads",
    create: (down) => ({
      ...down,
      table: (name) => {
        const table = down.table(name);
        if (name !== "packages") return table;
        return {
          ...table,
          get: async (req) => {
            const row = await table.get(req);
            if (row) reads.rows++;
            return row;
          },
          getMany: async (req) => {
            const rows = await table.getMany(req);
            reads.rows += rows.filter(Boolean).length;
            return rows;
          },
          query: async (req) => {
            const res = await table.query(req);
            if (req.values) reads.rows += res.result.length;
            return res;
          },
        };
      },
    }),
  });
  return reads;
}

function watch<T>(query: () => Promise<T>) {
  const seen: T[] = [];
  const subscription = liveQuery(query).subscribe({ next: (value) => seen.push(value) });
  return { seen, stop: () => subscription.unsubscribe() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("живые запросы курса не перечитывают пакеты", () => {
  let db: AppDatabase;
  let reads: { rows: number };
  beforeEach(async () => {
    await new AppDatabase("tetradio-outlines").delete();
    db = new AppDatabase("tetradio-outlines");
    reads = countPackageReads(db);
    await installLessons(db, LESSONS, memoryFetcher(demo));
  });
  afterEach(() => db.close());

  it("ответ в занятии пересчитывает «Прогресс» и ошибки без чтения пакетов", async () => {
    await completeLessons(db, ["m01-1"]);
    const pack = (await db.packages.get("m01-1"))!;
    const mistake = { kind: "mistake" as const, id: STORED_KINDS.mistake.packageIds({ ...pack, id: "m01-1" })[0] };
    await db.cardStates.put(nextState(undefined, mistake, Rating.Again, new Date(now.getTime() - 86_400_000)));
    const session = await makeSession({ source: dexieSource(db), now, random: () => 0.42, courseId: "greek-a2" });
    await db.sessions.add(session);
    const progress = watch(() => courseProgress(now, tz, "greek-a2", db));
    const views = watch(() => moduleViews("greek-a2", db));
    const mistakes = watch(() => mistakeCount("greek-a2", db));
    await settle();
    expect(mistakes.seen.at(-1)).toBe(1);
    const before = { rows: reads.rows, progress: progress.seen.length };

    await submitAnswer({
      session,
      item: session.items[0],
      correct: true,
      answer: "",
      responseTimeMs: 1000,
      activeTimeMs: 1000,
      timezone: tz,
      now,
      database: db,
    });
    await settle();
    expect(progress.seen.length).toBeGreaterThan(before.progress);
    expect(progress.seen.at(-1)!.week.cards).toBe(1);
    expect(reads.rows - before.rows).toBe(0);
    [progress, views, mistakes].forEach((query) => query.stop());
  });

  it("выполненное задание урока меняет счёт урока без чтения пакетов", async () => {
    const views = watch(() => moduleViews("greek-a2", db));
    await settle();
    const tally = (list: ModuleView[] | undefined) => list![0].lessons.find((lesson) => lesson.id === "m01-1")!.tally;
    expect(tally(views.seen.at(-1)).done).toBe(0);
    const before = reads.rows;
    await saveBlockProgress("m01-1", "forms", { done: true, answers: {} }, db, now);
    await settle();
    expect(tally(views.seen.at(-1)).done).toBe(1);
    // Завершение урока читает свой пакет; экран курса — нет.
    expect(reads.rows - before).toBeLessThanOrEqual(1);
    views.stop();
  });

  it("новая версия пакета сразу меняет счёт урока, навыки и пункты ошибок", async () => {
    const progress = watch(() => courseProgress(now, tz, "greek-a2", db));
    await settle();
    const lessonOf = (data: CourseProgress | undefined) =>
      data!.views[0].lessons.find((lesson) => lesson.id === "m01-1")!;
    const total = lessonOf(progress.seen.at(-1)).tally.total;
    const writing = progress.seen.at(-1)!.skills.find((skill) => skill.skill === "writing")!.total;
    const pack = demo.packages.find((item) => item.id === "m01-1")!;
    const forms = `m01-1/forms/${(pack.blocks!.find((block) => block.id === "forms") as { items: { id: string }[] }).items[0].id}`;
    expect(await STORED_KINDS.mistake.presentIds([forms], db)).toEqual([forms]);

    await applyPackage(
      {
        ...pack,
        version: `${pack.version}-next`,
        blocks: pack.blocks!.filter((block) => block.id !== "forms" && block.type !== "writing"),
      },
      db,
    );
    await settle();
    expect(lessonOf(progress.seen.at(-1)).tally.total).toBe(total - 2);
    expect(progress.seen.at(-1)!.skills.find((skill) => skill.skill === "writing")!.total).toBeLessThan(writing);
    expect(await STORED_KINDS.mistake.presentIds([forms], db)).toEqual([]);
    progress.stop();
  });

  it("внутри транзакции записи сводка берётся из пакета, а не из памяти", async () => {
    const pack = (await db.packages.get("m01-1"))!;
    const forms = STORED_KINDS.mistake.packageIds({ ...pack, id: "m01-1" })[0];
    expect(await STORED_KINDS.mistake.presentIds([forms], db)).toEqual([forms]);
    const inside = await db.transaction("rw", db.packages, async () => {
      await db.packages.put({ ...pack, blocks: [] });
      return STORED_KINDS.mistake.presentIds([forms], db);
    });
    expect(inside).toEqual([]);
    expect(await STORED_KINDS.mistake.presentIds([forms], db)).toEqual([]);
  });
});
