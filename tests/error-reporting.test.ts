import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { defaultSettings, fillSettings, type Settings } from "../src/domain/types";
import { LexiDatabase } from "../src/storage/db";
import { loadSettings } from "../src/storage/queries";

describe("настройка отчётов об ошибках", () => {
  it("запись без поля читается как включённая, по умолчанию отчёты включены", () => {
    expect(defaultSettings.errorReports).toBe(true);
    const legacy = { id: "settings", timezone: "Asia/Nicosia", sessionSize: 20 } as Settings;
    expect(fillSettings(legacy).errorReports).toBe(true);
    expect(fillSettings(undefined).errorReports).toBe(true);
  });
  it("сохранённое выключение переживает перечитывание из базы", async () => {
    const db = new LexiDatabase("lexi-error-reports");
    await db.delete();
    await db.open();
    await db.settings.put({ ...defaultSettings, errorReports: false });
    expect((await loadSettings(db)).errorReports).toBe(false);
    db.close();
  });
});

describe("границы данных в сообщениях ошибок", () => {
  it("ошибка сохранения ответа не несёт слово, перевод и ответ пользователя ни в сообщении, ни в стеке", async () => {
    const { LexiDatabase } = await import("../src/storage/db");
    const { dexieSource } = await import("../src/storage/queries");
    const { makeSession } = await import("../src/domain/learning");
    const { recordAnswer } = await import("../src/storage/ops");
    const { installLessons } = await import("./helpers/content");
    const db = new LexiDatabase("lexi-error-message");
    await db.delete();
    await db.open();
    await installLessons(db, ["lesson-1-1"]);
    const now = new Date("2026-09-16T09:00:00Z");
    const session = await makeSession({ source: dexieSource(db), now, random: () => 0.3 });
    await db.sessions.add(session);
    const item = session.items.find((entry) => entry.type !== "recall")!;
    const word = (item.card as { kind: "word"; word: { greek: string; russian: string } }).word;
    const secret = [word.greek, word.russian, "мой тайный ответ"];
    const failures: unknown[] = [];
    // Конфликт версий: слово уже отвечено в другой вкладке.
    await recordAnswer({
      session,
      item: { ...item, expectedVersion: 99 },
      correct: false,
      answer: secret[2],
      responseTimeMs: 1,
      activeTimeMs: 1,
      timezone: "UTC",
      now,
      database: db,
    }).catch((error) => failures.push(error));
    // Отказ хранилища: база закрыта.
    db.close();
    await recordAnswer({
      session,
      item,
      correct: true,
      answer: secret[2],
      responseTimeMs: 1,
      activeTimeMs: 1,
      timezone: "UTC",
      now,
      database: db,
    }).catch((error) => failures.push(error));
    expect(failures).toHaveLength(2);
    for (const failure of failures) {
      const text = [String(failure), (failure as Error).message, (failure as Error).stack ?? ""].join("\n");
      for (const word of secret) expect(text).not.toContain(word);
    }
  });
});

describe("явные отчёты о критических отказах", () => {
  it("отклонённый пакет урока даёт отчёт категории «контент» с идентификатором и версией, но без содержимого; отсутствие сети отчёта не даёт", async () => {
    const { pendingReports, resetReporting } = await import("../src/reporting/reporting");
    const { installLesson, refreshCatalog } = await import("../src/content/client");
    const { content, memoryFetcher, packageOf } = await import("./helpers/content");
    resetReporting({ dsn: "https://key@o1.ingest.sentry.io/1", loader: () => Promise.reject(new Error("не в тесте")) });
    const db = new LexiDatabase("lexi-report-content");
    await db.delete();
    await db.open();
    const entry = content.catalog.lessons.find((lesson) => lesson.id === "lesson-1-1")!;
    const pack = packageOf("lesson-1-1");
    const broken = memoryFetcher(content, { [entry.url]: { ...pack, words: pack.words.slice(1) } });
    await refreshCatalog(db, broken);
    await expect(installLesson("lesson-1-1", db, broken)).rejects.toBeInstanceOf(Error);
    const reports = pendingReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      category: "content",
      extra: { kind: "schema", packageId: "lesson-1-1", packageVersion: entry.version },
    });
    const text = JSON.stringify(reports[0].extra);
    for (const word of pack.words.slice(0, 3)) expect(text).not.toContain(word.greek);
    // Нет сети: пакет не загружен — это офлайн, а не сбой.
    const { ContentError } = await import("../src/content/schema");
    await refreshCatalog(db, memoryFetcher());
    const offline = {
      json: async () => {
        throw new ContentError("Нет сети", "network");
      },
      // eslint-disable-next-line typescript/unbound-method -- blob — замыкание тестового источника, this не использует
      blob: memoryFetcher().blob,
    };
    await expect(installLesson("lesson-1-2", db, offline)).rejects.toMatchObject({ kind: "network" });
    expect(pendingReports()).toHaveLength(1);
    resetReporting();
    db.close();
  });
  it("координатор синхронизации сообщает об ошибке с её видом через onFailure", async () => {
    const { SyncCoordinator } = await import("../src/sync/coordinator");
    const { kvAdapter } = await import("../src/sync/adapter");
    const { memoryTransport, SyncError } = await import("../src/sync/transport");
    const { installLessons } = await import("./helpers/content");
    const db = new LexiDatabase("lexi-report-sync");
    await db.delete();
    await db.open();
    await installLessons(db, ["lesson-1-1"]);
    const broken = memoryTransport({
      intercept: (op) => {
        if (op === "getKeys") throw new SyncError("transport", "CloudStorage timeout");
      },
    });
    const failures: { error: unknown; kind: string }[] = [];
    const sync = new SyncCoordinator({
      database: db,
      adapter: kvAdapter(broken),
      schedule: () => () => undefined,
      retryBaseMs: 1000,
    });
    sync.onFailure = (error, kind) => failures.push({ error, kind });
    expect((await sync.exchange()).phase).toBe("error");
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("transport");
    expect(failures[0].error).toBeInstanceOf(Error);
    db.close();
  });
});
