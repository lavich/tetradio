import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { LexiDatabase } from "../src/storage/db";
import { reopenDatabase, storageHealer } from "../src/storage/recovery";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { memoryTransport, type MemoryTransport } from "../src/sync/transport";

/**
 * Синхронизация работает вне дерева React, поэтому граница Recovery её не прикрывает: отказ IndexedDB
 * после сна WebView приходил в отчёт категории «sync». Лечение то же, что у экрана, — переоткрытие базы.
 */
let cloud: MemoryTransport;
let counter = 0;
const clockMs = Date.parse("2026-09-20T07:06:00Z");

/** База, закрытая без автооткрытия, ведёт себя как IndexedDB WebKit после сна: любое чтение падает. */
async function asleep(name: string) {
  const database = new LexiDatabase(`lexi-sync-recovery-${name}-${++counter}`);
  await database.delete();
  await database.open();
  database.close({ disableAutoOpen: true });
  return database;
}
function coordinator(database: LexiDatabase, recover: (error: unknown) => Promise<boolean>) {
  const failures: string[] = [];
  const sync = new SyncCoordinator({
    database,
    adapter: kvAdapter(cloud),
    now: () => new Date(clockMs),
    label: "ios",
    schedule: () => () => undefined,
    retryBaseMs: 1,
    recover,
  });
  sync.onFailure = (_error, kind) => {
    failures.push(kind);
  };
  return { sync, failures };
}

beforeEach(() => {
  cloud = memoryTransport();
});

describe("отказ хранилища в синхронизации", () => {
  it("лечится переоткрытием базы: обмен доходит до конца, отчёта нет, остаётся крошка с номером попытки", async () => {
    const database = await asleep("healed");
    const attempts: number[] = [];
    const heal = storageHealer({
      reopen: () => reopenDatabase(database),
      onRecovered: (attempt) => attempts.push(attempt),
    });
    const { sync, failures } = coordinator(database, heal);
    const status = await sync.exchange();
    expect(status.phase).toBe("synced");
    expect(failures).toEqual([]);
    expect(attempts).toEqual([1]);
    database.close();
  });

  it("уходит в отчёт один раз, когда переоткрытие не помогло", async () => {
    const database = await asleep("failed");
    const heal = storageHealer({ reopen: () => Promise.reject(new Error("нет места")) });
    const { sync, failures } = coordinator(database, heal);
    const status = await sync.exchange();
    expect(status.phase).toBe("error");
    expect(failures).toEqual(["unknown"]);
    database.close();
  });
});
