import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { dexieSource } from "../src/storage/queries";
import { recordAnswer, skipItem } from "../src/storage/ops";
import { makeSession } from "../src/domain/learning";
import { exportFull, inspectBackup, restoreBackup, transferFile, TRANSFER_TEXT } from "../src/features/backup/backup";
import { META, readMeta, writeMeta } from "../src/sync/snapshot";
import { installCompleted } from "./helpers/content";

const now = new Date("2026-09-16T09:00:00Z");
let db: AppDatabase;
beforeEach(async () => {
  await new AppDatabase("tetradio-tg-ui").delete();
  db = new AppDatabase("tetradio-tg-ui");
  await db.open();
  await installCompleted(db, ["mech-1"]);
});
afterEach(() => db.close());

describe("жизненный цикл ответа", () => {
  it("повторная запись того же ответа сообщает created:false — отклик и синхронизация не повторяются", async () => {
    const session = await makeSession({ source: dexieSource(db), now, random: () => 0.3 });
    await db.sessions.add(session);
    const item = session.items[0];
    const first = await recordAnswer({
      session,
      item,
      correct: true,
      answer: "",
      responseTimeMs: 1,
      activeTimeMs: 1,
      timezone: "UTC",
      now,
      database: db,
    });
    const mark = await readMeta(db, META.dirty);
    const second = await recordAnswer({
      session,
      item,
      correct: true,
      answer: "",
      responseTimeMs: 1,
      activeTimeMs: 1,
      timezone: "UTC",
      now,
      database: db,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event).toEqual(first.event);
    expect(await db.events.count()).toBe(1);
    // Отметка изменений не обновилась: повтор не считается новым изменением.
    expect(mark).toBeTruthy();
    expect(await readMeta(db, META.dirty)).toBe(mark);
  });
  it("пропуск аудирования не создаёт события и не двигает интервал, но сдвигает позицию занятия", async () => {
    const session = await makeSession({ source: dexieSource(db), now, random: () => 0.3 });
    await db.sessions.add(session);
    const item = session.items[1];
    const before = await db.cardStates.get(item.unitKey);
    await skipItem(session.id, item.id, 500, db);
    const stored = (await db.sessions.get(session.id))!;
    expect(stored.items[1].skipped).toBe(true);
    expect(stored.index).toBe(1);
    expect(stored.status).toBe("active");
    expect(await db.events.count()).toBe(0);
    expect(await db.cardStates.get(item.unitKey)).toEqual(before);
    // Ответ на следующий элемент считает пропущенный пройденным при подсчёте позиции.
    const next = stored.items.find((entry) => !entry.eventId && !entry.skipped)!;
    await recordAnswer({
      session: stored,
      item: next,
      correct: false,
      answer: "",
      responseTimeMs: 1,
      activeTimeMs: 1,
      timezone: "UTC",
      now,
      database: db,
    });
    expect((await db.sessions.get(session.id))!.index).toBe(2);
  });
});

describe("передача файла копии", () => {
  const blob = new Blob(["{}"], { type: "application/json" });
  it("файловый share предпочтителен в мобильном Telegram; отмена отличается от ошибки и не считается сохранением", async () => {
    expect(
      await transferFile(blob, "a.json", {
        preferShare: true,
        canShare: () => true,
        share: async () => undefined,
        download: () => undefined,
        downloadSupported: true,
      }),
    ).toBe("shared");
    expect(
      await transferFile(blob, "a.json", {
        preferShare: true,
        canShare: () => true,
        share: async () => {
          throw Object.assign(new Error("cancel"), { name: "AbortError" });
        },
        download: () => undefined,
        downloadSupported: true,
      }),
    ).toBe("cancelled");
    const downloads: string[] = [];
    expect(
      await transferFile(blob, "a.json", {
        preferShare: true,
        canShare: () => true,
        share: async () => {
          throw new Error("fail");
        },
        download: (_, name) => {
          downloads.push(name);
        },
        downloadSupported: true,
      }),
    ).toBe("downloaded");
    expect(downloads).toEqual(["a.json"]);
    expect(
      await transferFile(blob, "a.json", {
        canShare: () => false,
        download: () => {
          downloads.push("x");
        },
        downloadSupported: true,
      }),
    ).toBe("downloaded");
    let shared = false;
    expect(
      await transferFile(blob, "a.json", {
        canShare: () => true,
        share: async () => {
          shared = true;
        },
        download: () => undefined,
        downloadSupported: true,
      }),
    ).toBe("downloaded");
    expect(shared).toBe(false);
    expect(await transferFile(blob, "a.json", { downloadSupported: false })).toBe("unsupported");
    expect(
      await transferFile(blob, "a.json", {
        preferShare: true,
        canShare: () => true,
        share: async () => {
          throw new Error("fail");
        },
        downloadSupported: false,
      }),
    ).toBe("failed");
    for (const text of Object.values(TRANSFER_TEXT)) expect(text).not.toMatch(/сохранена|сохранён\b/);
  });
  it("копия профиля Telegram читается обычным восстановлением и не переносит служебные ключи синхронизации", async () => {
    const telegram = new AppDatabase("tetradio-tg-tetradio_local-77");
    await telegram.delete();
    await telegram.open();
    await installCompleted(telegram, ["mech-1"]);
    await writeMeta(telegram, META.device, "device-a");
    await writeMeta(telegram, META.dirty, "1");
    const copy = await exportFull(telegram);
    const check = await inspectBackup(copy);
    expect(check).toMatchObject({ ok: true, report: { databaseName: "tetradio-tg-tetradio_local-77", legacy: false } });
    await writeMeta(db, META.device, "device-b");
    await restoreBackup(copy, db);
    expect(await readMeta(db, META.device)).toBe("device-b"); // свой идентификатор устройства сохранён
    expect(await readMeta(db, META.restored)).not.toBeNull(); // облако не откатится молча
    expect(await readMeta(db, META.dirty)).toBeNull();
    const parsed = JSON.parse(await copy.text());
    const meta = parsed.data.data.find((table: { tableName: string }) => table.tableName === "meta");
    expect(meta.rows.some((row: { key: string }) => row.key.startsWith("sync:"))).toBe(false);
    expect(parsed.data.tables.map((table: { name: string }) => table.name)).not.toContain("syncVersions");
    telegram.close();
  });
});
