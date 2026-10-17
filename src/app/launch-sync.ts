import type { TelegramWebApp } from "../platform/telegram-types";
import { ownerMatches, type Profile } from "../storage/profile";

type ConnectSync = (app: TelegramWebApp | null) => void;
export interface LaunchSyncOptions {
  profile: Profile;
  stopped: () => boolean;
  onMismatch: () => void;
  connectSync: Promise<ConnectSync>;
}

/** Синхронизация подключается только после сверки владельца с пользователем bridge. */
export function launchSync({ profile, stopped, onMismatch, connectSync }: LaunchSyncOptions) {
  // Отказ чанка до первого подключения не должен уйти в отчёт о сбое: его разбирает `connect`.
  connectSync.catch(() => undefined);
  return (app: TelegramWebApp | null): Promise<void> => {
    if (stopped()) return Promise.resolve();
    if (!ownerMatches(profile, app?.initDataUnsafe?.user?.id)) {
      onMismatch();
      return Promise.resolve();
    }
    return connectSync
      .then((connect) => {
        if (!stopped()) connect(app);
      })
      .catch((error) => console.warn("Синхронизация не подключена", error));
  };
}

/** База не открылась — синхронизация не подключается: каждый повтор обмена слал бы новый отчёт о том же сбое. */
export function syncOnceOpened(opened: Promise<unknown>, load: Promise<ConnectSync>): Promise<ConnectSync> {
  const skip: ConnectSync = () => undefined;
  return Promise.all([
    opened.then(
      () => true,
      () => false,
    ),
    load,
  ]).then(([open, connect]) => (open ? connect : skip));
}

/** Загрузка после запуска с отменой; отказ чанка не должен стать необработанным до подключения облака. */
export function deferredLoad<T>(schedule: (run: () => void) => () => void, load: () => Promise<T>) {
  let cancel = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    cancel = schedule(() => load().then(resolve, reject));
  });
  promise.catch(() => undefined);
  return { promise, cancel: () => cancel() };
}
