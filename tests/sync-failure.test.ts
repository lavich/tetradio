import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/storage/db";
import { kvAdapter } from "../src/sync/adapter";
import { SyncCoordinator } from "../src/sync/coordinator";
import { syncFailureReporter } from "../src/sync/failure";
import { cloudStorageTransport, SyncError } from "../src/sync/transport";
import type { TelegramCloudStorage } from "../src/platform/telegram-types";

const throwing = (error: Error) =>
  ({
    getKeys: () => {
      throw error;
    },
    getItems: () => {
      throw error;
    },
    setItem: () => {
      throw error;
    },
    removeItems: () => {
      throw error;
    },
  }) as unknown as TelegramCloudStorage;

describe("упавший вызов CloudStorage", () => {
  it("отличается от клиента без хранилища и объясняет, что делать", async () => {
    const cause = new Error("WebAppMethodUnsupported");
    const failure = await cloudStorageTransport(throwing(cause))
      .getKeys()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncError);
    expect(failure).toMatchObject({ kind: "bridge", cause });
    expect((failure as SyncError).message).toBe(
      "Облако Telegram не отвечает. Прогресс сохранён на этом устройстве. Если не пройдёт — перезапустите приложение.",
    );
  });

  it("уходит в отчёты один раз за запуск, клиент без хранилища и отключённый транспорт — никогда", () => {
    const report = vi.fn();
    const onFailure = syncFailureReporter(report);
    const broken = new SyncError("bridge", "x");
    onFailure(broken, "bridge");
    onFailure(broken, "bridge");
    onFailure(new SyncError("unavailable", "x"), "unavailable");
    onFailure(new SyncError("disabled", "x"), "disabled");
    const lost = new SyncError("transport", "x");
    onFailure(lost, "transport");
    onFailure(lost, "transport");
    expect(report.mock.calls.map(([, kind]) => kind)).toEqual(["bridge", "transport", "transport"]);
  });

  it("повторяется по общей схеме: через 30 с, затем вдвое реже", async () => {
    const database = new AppDatabase("tetradio-sync-failure-retry");
    await database.delete();
    await database.open();
    const delays: number[] = [];
    const sync = new SyncCoordinator({
      database,
      adapter: kvAdapter(cloudStorageTransport(throwing(new Error("bridge lost")))),
      label: "macos",
      schedule: (_run, ms) => {
        delays.push(ms);
        return () => undefined;
      },
    });
    const first = await sync.exchange();
    await sync.exchange();
    expect(first.phase).toBe("error");
    expect(first.error).toMatchObject({ kind: "bridge" });
    expect(delays).toEqual([30_000, 60_000]);
    database.close();
  });
});
