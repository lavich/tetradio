import { describe, expect, it, vi } from "vitest";
import { launchSync, syncOnceOpened } from "../src/app/launch-sync";
import type { TelegramWebApp } from "../src/platform/telegram-types";
import type { Profile } from "../src/storage/profile";
import type { SyncStatus } from "../src/sync/coordinator";
import { syncLineState } from "../src/sync/status-text";

const profile: Profile = {
  kind: "telegram",
  bot: "tetradio_local",
  userId: 7,
  databaseName: "tetradio-tg-tetradio_local-7",
  syncable: true,
  label: "",
};
const bridgeOf = (id: number) => ({ initDataUnsafe: { user: { id } } }) as unknown as TelegramWebApp;
function setup() {
  let stopped = false;
  const connectSync = vi.fn();
  const onMismatch = vi.fn(() => {
    stopped = true;
  });
  const connect = launchSync({
    profile,
    stopped: () => stopped,
    onMismatch,
    connectSync: Promise.resolve(connectSync),
  });
  return { connect, connectSync, onMismatch, stop: () => (stopped = true) };
}

describe("подключение синхронизации при запуске", () => {
  it("тайм-аут bridge подключает синхронизацию без облака", async () => {
    const { connect, connectSync, onMismatch } = setup();
    await connect(null);
    expect(connectSync).toHaveBeenCalledWith(null);
    expect(onMismatch).not.toHaveBeenCalled();
  });
  it("поздний bridge своего пользователя после тайм-аута подключает облако", async () => {
    const { connect, connectSync } = setup();
    const app = bridgeOf(7);
    await connect(null);
    await connect(app);
    expect(connectSync.mock.calls).toEqual([[null], [app]]);
  });
  it("поздний bridge другого пользователя останавливает запуск, облако не подключается", async () => {
    const { connect, connectSync, onMismatch } = setup();
    await connect(null);
    await connect(bridgeOf(8));
    expect(onMismatch).toHaveBeenCalledOnce();
    expect(connectSync.mock.calls).toEqual([[null]]);
  });
  it("остановленный запуск не подключает синхронизацию", async () => {
    const { connect, connectSync, stop } = setup();
    stop();
    await connect(bridgeOf(7));
    expect(connectSync).not.toHaveBeenCalled();
  });
});

describe("текст строки синхронизации", () => {
  const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
    phase: "disabled",
    lastConfirmedAt: null,
    dirty: false,
    error: null,
    conflict: null,
    keys: null,
    reason: null,
    ...over,
  });
  it("пока bridge грузится после тайм-аута — подключение к Telegram без повтора", () => {
    expect(syncLineState(status({ dirty: true }), "slow")).toEqual({
      phase: "connecting",
      text: "Подключение к Telegram…",
      retry: false,
      failed: false,
    });
  });
  it("сорвавшаяся загрузка bridge — синхронизация недоступна, перезапуск", () => {
    expect(syncLineState(status(), "failed")).toMatchObject({
      phase: "unavailable",
      text: "Синхронизация недоступна — перезапустите приложение",
      retry: false,
    });
  });
  it("с bridge и вне Telegram — статус координатора", () => {
    expect(syncLineState(status({ phase: "idle", dirty: true }), "ready")).toEqual({
      phase: "idle",
      text: "Сохранено на устройстве · есть неотправленные изменения",
      retry: true,
      failed: false,
    });
    expect(syncLineState(status(), "none")).toMatchObject({ text: "Только на этом устройстве", retry: false });
    expect(syncLineState(status({ phase: "error" }), "ready")).toMatchObject({ failed: true, retry: true });
  });
  it("база не открылась: синхронизация не подключается и не шлёт отчёты повторов", async () => {
    const connectSync = vi.fn();
    const connect = launchSync({
      profile,
      stopped: () => false,
      onMismatch: vi.fn(),
      connectSync: syncOnceOpened(
        Promise.reject(new DOMException("denied", "SecurityError")),
        Promise.resolve(connectSync),
      ),
    });
    await connect(bridgeOf(7));
    expect(connectSync).not.toHaveBeenCalled();
  });
  it("открытая база подключает синхронизацию как обычно", async () => {
    const connectSync = vi.fn();
    const connect = launchSync({
      profile,
      stopped: () => false,
      onMismatch: vi.fn(),
      connectSync: syncOnceOpened(Promise.resolve(), Promise.resolve(connectSync)),
    });
    const app = bridgeOf(7);
    await connect(app);
    expect(connectSync).toHaveBeenCalledWith(app);
  });
});
