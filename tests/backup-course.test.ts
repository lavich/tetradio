import "fake-indexeddb/auto";
import "./helpers/self";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { refreshCatalog } from "../src/content/client";
import { exportFull, inspectBackup, restoreBackup } from "../src/features/backup/backup";
import { CloudChangedError, cloudPrint } from "../src/features/backup/cloud-check";
import { AppDatabase } from "../src/storage/db";
import { blockProgressOf, completeLesson, saveBlockProgress } from "../src/storage/course";
import { saveSettings } from "../src/storage/ops";
import { defaultSettings } from "../src/domain/types";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { META, readMeta, writeMeta } from "../src/sync/snapshot";
import { disabledTransport, memoryTransport, type MemoryTransport } from "../src/sync/transport";
import { installLessons, memoryFetcher } from "./helpers/content";

const demo = buildContent("tests/fixtures/course-demo");
const fetcher = () => memoryFetcher(demo);
const CARD_TABLES = ["words", "phrases", "lessonItems", "cardStates", "cardSkills", "cardStash", "events", "sessions"];

let counter = 0;
async function open(name: string, lessons: string[] | null = ["m01-1"]) {
  const database = new AppDatabase(name.startsWith("tetradio-") ? name : `tetradio-backup-${name}-${++counter}`);
  await database.delete();
  await database.open();
  if (lessons) await installLessons(database, lessons, fetcher());
  return database;
}
async function finishLesson(database: AppDatabase) {
  await saveBlockProgress("m01-1", "forms", { done: true, answers: { q1: "είμαι", q2: "είσαι" } }, database);
  await saveBlockProgress("m01-1", "anna-tf", { done: true, answers: { q1: "Σωστό" } }, database);
  await saveBlockProgress("m01-1", "cafe-q", { done: true, score: { correct: 1, almost: 1, total: 2 } }, database);
  await saveBlockProgress("m01-1", "about-me", { done: true, text: "Με λένε Ιβάν.", checks: [0, 2] }, database);
  await saveBlockProgress("m01-1", "intro", { done: true, checks: [1] }, database);
  await completeLesson("m01-1", database);
}
type Dump = { data: { databaseName: string; tables: { name: string; rowCount: number }[]; data: Table[] } };
type Table = { tableName: string; rows: Record<string, unknown>[] };
const parse = async (blob: Blob): Promise<Dump> => JSON.parse(await blob.text());
const table = (dump: Dump, name: string) => dump.data.data.find((entry) => entry.tableName === name)!;
const setRows = (dump: Dump, name: string, rows: Record<string, unknown>[]) => {
  table(dump, name).rows = rows;
  dump.data.tables.find((entry) => entry.name === name)!.rowCount = rows.length;
};
const blob = (dump: Dump) => new Blob([JSON.stringify(dump)], { type: "application/json" });
/** Копия ученика, который проходил только курс: карточек нет, прогресс блоков и завершённый урок есть. */
async function courseOnly(source: AppDatabase) {
  await finishLesson(source);
  const dump = await parse(await exportFull(source));
  for (const name of CARD_TABLES) setRows(dump, name, []);
  return dump;
}
const state = async (database: AppDatabase) => ({
  words: await database.words.count(),
  lessons: await database.lessons.toArray(),
  blocks: await database.blockProgress.toArray(),
  settings: await database.settings.toArray(),
});

let target: AppDatabase;
beforeEach(async () => {
  target = await open("target");
  await saveBlockProgress("m01-1", "intro", { done: true, checks: [0] }, target);
});

describe("копия с прогрессом курса", () => {
  it("копия без карточек восстанавливает блоки с ответами и текстом и завершение урока", async () => {
    const dump = await courseOnly(await open("source"));
    expect((await inspectBackup(blob(dump), target)).ok).toBe(true);
    await restoreBackup(blob(dump), target);
    expect(await target.words.count()).toBe(0);
    expect((await target.lessons.get("m01-1"))?.completed).toBe(true);
    const blocks = await blockProgressOf("m01-1", target);
    expect(blocks.size).toBe(5);
    // Копия — полная локальная: в отличие от снимка облака, ответы и текст письма в ней есть.
    expect(blocks.get("forms")?.answers).toEqual({ q1: "είμαι", q2: "είσαι" });
    expect(blocks.get("about-me")).toMatchObject({ text: "Με λένε Ιβάν.", checks: [0, 2] });
    expect(blocks.get("cafe-q")?.score).toEqual({ correct: 1, almost: 1, total: 2 });
  });
  it("блоки неустановленного урока из каталога восстанавливаются", async () => {
    const source = await open("catalog-only", null);
    await refreshCatalog(source, fetcher());
    await saveBlockProgress("m01-test", "x", { done: true }, source);
    const file = await exportFull(source);
    await restoreBackup(file, target);
    expect((await target.blockProgress.toArray()).map((row) => row.key)).toEqual(["m01-test/x"]);
  });
  it("пустая копия — ни карточек, ни прогресса курса — отклоняется", async () => {
    const dump = await courseOnly(await open("source"));
    setRows(dump, "blockProgress", []);
    setRows(
      dump,
      "lessons",
      table(dump, "lessons").rows.map((row) => ({ ...row, completed: false })),
    );
    const before = await state(target);
    await expect(restoreBackup(blob(dump), target)).rejects.toThrow(/восстанавливать нечего/);
    expect(await state(target)).toEqual(before);
  });
});

describe("отказ до изменения текущих данных", () => {
  const broken: [string, (row: Record<string, unknown>) => Record<string, unknown>, RegExp][] = [
    ["ключ не совпадает с уроком и блоком", (row) => ({ ...row, key: "m01-1/other" }), /ключ/],
    ["нет отметки выполнения", (row) => ({ ...row, done: "yes" }), /отметки выполнения/],
    ["нет даты изменения", (row) => ({ ...row, updatedAt: 42 }), /даты изменения/],
    ["нет блока", ({ blockId: _b, ...row }) => ({ ...row, key: "m01-1/" }), /нет урока или блока/],
    ["счёт не числа", (row) => ({ ...row, score: { correct: "1", almost: 0, total: 2 } }), /счёт/],
    ["критерии не числа", (row) => ({ ...row, checks: ["a"] }), /критерии/],
  ];
  for (const [name, change, message] of broken)
    it(`повреждённый прогресс блока: ${name}`, async () => {
      const dump = await courseOnly(await open("source"));
      const rows = table(dump, "blockProgress").rows;
      setRows(dump, "blockProgress", [change(rows[0]), ...rows.slice(1)]);
      const before = await state(target);
      expect(await inspectBackup(blob(dump), target)).toMatchObject({ ok: false, message: message });
      await expect(restoreBackup(blob(dump), target)).rejects.toThrow(message);
      expect(await state(target)).toEqual(before);
    });
  it("блок урока, которого нет ни в копии, ни в каталоге, отклоняется", async () => {
    const dump = await courseOnly(await open("source"));
    const rows = table(dump, "blockProgress").rows;
    setRows(dump, "blockProgress", [
      ...rows,
      { ...rows[0], key: `ghost/${String(rows[0].blockId)}`, lessonId: "ghost" },
    ]);
    const before = await state(target);
    await expect(restoreBackup(blob(dump), target)).rejects.toThrow(/урок ghost/);
    expect(await state(target)).toEqual(before);
  });
  it("урок курса с неизвестным идентификатором отклоняется, если каталог загружен", async () => {
    const dump = await courseOnly(await open("source"));
    const lessons = table(dump, "lessons").rows;
    const course = lessons.find((row) => row.id === "m01-1")!;
    setRows(dump, "lessons", [...lessons, { ...course, id: "m99-9", completed: true }]);
    const before = await state(target);
    await expect(restoreBackup(blob(dump), target)).rejects.toThrow(/m99-9.*каталоге/);
    expect(await state(target)).toEqual(before);
    setRows(dump, "lessons", [...lessons, { ...course, completed: "yes" }]);
    await expect(restoreBackup(blob(dump), target)).rejects.toThrow(/некорректная отметка завершения/);
  });
  it("неподдерживаемая версия схемы и маркера отклоняются", async () => {
    const dump = await courseOnly(await open("source"));
    const before = await state(target);
    const newer = structuredClone(dump);
    (newer.data as { databaseVersion?: number }).databaseVersion = 99;
    await expect(restoreBackup(blob(newer), target)).rejects.toThrow(/более новой версией/);
    const marker = structuredClone(dump);
    table(marker, "meta").rows = table(marker, "meta").rows.map((row) =>
      row.key === "app" ? { ...row, value: "tetradio:99" } : row,
    );
    await expect(restoreBackup(blob(marker), target)).rejects.toThrow(/Неизвестная версия формата/);
    await expect(restoreBackup(new Blob(['{"formatName":"dexie"']), target)).rejects.toThrow(/повреждён/);
    expect(await state(target)).toEqual(before);
  });
});

describe("владелец", () => {
  it("копия чужого профиля восстанавливается в текущую базу; служебные ключи и владелец из файла не используются", async () => {
    const foreign = await open("tetradio-tg-bot-111");
    await writeMeta(foreign, META.device, "foreign-device");
    await writeMeta(foreign, META.clock, JSON.stringify({ "foreign-device": 9 }));
    await writeMeta(foreign, META.pendingLessons, JSON.stringify({ x: "2026-09-01T00:00:00Z" }));
    await finishLesson(foreign);
    const file = await exportFull(foreign);
    const text = await file.text();
    // Токенов и данных запуска нет; служебные ключи синхронизации остаются на устройстве.
    for (const secret of ["sync:", "foreign-device", "initData", "tgWebAppData", "hash"])
      expect(text).not.toContain(secret);
    const own = await open("tetradio-tg-bot-222");
    await writeMeta(own, META.device, "own-device");
    await restoreBackup(file, own);
    expect(own.name).toBe("tetradio-tg-bot-222");
    expect(await readMeta(own, META.device)).toBe("own-device");
    expect(await readMeta(own, META.clock)).toBeNull();
    expect(await readMeta(own, META.pendingLessons)).toBeNull();
    expect(await readMeta(own, META.restored)).not.toBeNull();
    expect((await own.lessons.get("m01-1"))?.completed).toBe(true);
  });
});

describe("конкурентное изменение облака после предпросмотра", () => {
  let cloud: MemoryTransport;
  let clockMs = 0;
  const now = () => new Date(clockMs);
  const coordinator = (database: AppDatabase, label: string, transport = cloud) =>
    new SyncCoordinator({
      database,
      adapter: kvAdapter(transport),
      now,
      label,
      schedule: () => () => undefined,
      retryBaseMs: 1,
    });
  beforeEach(() => {
    cloud = memoryTransport();
    clockMs = Date.parse("2026-09-16T08:00:00Z");
  });
  /** Телефон (цель восстановления) публикует первым; компьютер получает его версию и публикует свои изменения. */
  async function scene() {
    const file = blob(await courseOnly(await open("source")));
    const mine = coordinator(target, "phone");
    expect((await mine.exchange()).phase).toBe("synced");
    const desktop = await open("desktop", null);
    const other = coordinator(desktop, "desktop");
    expect((await other.exchange()).phase).toBe("synced");
    const adapter = mine.adapter;
    const guard = { seen: await cloudPrint(adapter, target), read: () => cloudPrint(adapter, target) };
    expect(guard.seen).not.toBeNull();
    return { file, desktop, other, mine, guard };
  }
  it("изменение на другом устройстве останавливает замену и ничего не меняет", async () => {
    const { file, desktop, other, guard } = await scene();
    clockMs += 60000;
    await saveSettings({ ...defaultSettings, sessionSize: 7 }, desktop);
    expect((await other.exchange()).phase).toBe("synced");
    const before = await state(target);
    const restored = await readMeta(target, META.restored);
    const error = await restoreBackup(file, target, { cloud: guard }).catch((caught) => caught);
    expect(error).toBeInstanceOf(CloudChangedError);
    expect(error.message).toBe("Данные аккаунта изменились на другом устройстве — откройте предпросмотр заново.");
    expect(await state(target)).toEqual(before);
    expect(await readMeta(target, META.restored)).toBe(restored);
    const fresh = { ...guard, seen: await guard.read() };
    await restoreBackup(file, target, { cloud: fresh });
    expect((await target.lessons.get("m01-1"))?.completed).toBe(true);
  });
  it("неизменное облако и публикация этого же устройства не мешают замене", async () => {
    const file = blob(await courseOnly(await open("source")));
    const mine = coordinator(target, "phone");
    expect((await mine.exchange()).phase).toBe("synced");
    const guard = { seen: await cloudPrint(mine.adapter, target), read: () => cloudPrint(mine.adapter, target) };
    expect(guard.seen).toBe("[]");
    clockMs += 60000;
    await saveSettings({ ...defaultSettings, sessionSize: 5 }, target);
    expect((await mine.exchange()).phase).toBe("synced");
    await restoreBackup(file, target, { cloud: guard });
    expect((await target.lessons.get("m01-1"))?.completed).toBe(true);
    expect(await readMeta(target, META.restored)).not.toBeNull();
  });
  it("облако, появившееся после предпросмотра без облака, требует нового предпросмотра", async () => {
    const { file, mine } = await scene();
    const read = () => cloudPrint(mine.adapter, target);
    const before = await state(target);
    await expect(restoreBackup(file, target, { cloud: { seen: null, read } })).rejects.toBeInstanceOf(
      CloudChangedError,
    );
    expect(await state(target)).toEqual(before);
  });
  it("без CloudStorage (браузерная сборка) сверка пропускается", async () => {
    const file = blob(await courseOnly(await open("source")));
    const adapter = kvAdapter(disabledTransport());
    const guard = { seen: await cloudPrint(adapter, target), read: () => cloudPrint(adapter, target) };
    expect(guard.seen).toBeNull();
    await restoreBackup(file, target, { cloud: guard });
    expect((await target.lessons.get("m01-1"))?.completed).toBe(true);
  });
});
