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
