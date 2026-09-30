import { useSyncExternalStore } from "react";
import { installLesson } from "../content/client";
import { launchContext } from "../platform/launch";
import type { TelegramWebApp } from "../platform/telegram-types";
import { lifecycle, reportError } from "../reporting/reporting";
import { db } from "../storage/db";
import { currentProfile } from "../storage/profile";
import { storageHealer } from "../storage/recovery";
import { kvAdapter } from "./adapter";
import { SyncCoordinator, webLock, type SyncStatus } from "./coordinator";
import { cloudStorageTransport, disabledTransport } from "./transport";

/** Отказ IndexedDB после сна WebView лечится переоткрытием базы; вылеченный отказ даёт только крошку, не отчёт. */
const heal = storageHealer({ onRecovered: (attempt) => lifecycle("storageRecovered", { attempt }) });
/**
 * Координатор приложения. В обычном браузере транспорт отключён явно; внутри Telegram после готовности bridge
 * подключается CloudStorage текущего пользователя и бота. Стандартные пакеты, нужные полученному прогрессу, догружаются.
 */
export const sync = new SyncCoordinator({
  database: db,
  adapter: kvAdapter(disabledTransport()),
  label: launchContext().platform ?? "",
  lock: webLock(`lexi-sync-${db.name}`),
  recover: heal,
});
sync.onMissingPackages = (ids) => {
  for (const id of ids) installLesson(id).catch(() => undefined);
};
// Отключённый транспорт и клиент без CloudStorage — штатные состояния, не сбои.
sync.onFailure = (error, kind) => {
  if (kind !== "disabled" && kind !== "unavailable") reportError(error, { category: "sync", extra: { kind } });
};

export function connectSync(app: TelegramWebApp | null) {
  const profile = currentProfile();
  if (!profile.syncable || !app?.CloudStorage || typeof app.CloudStorage.getItems !== "function") {
    if (profile.kind === "telegram") sync.setAdapter(kvAdapter(disabledTransport()));
    return;
  }
  sync.setAdapter(kvAdapter(cloudStorageTransport(app.CloudStorage)));
  sync.start();
}
export const useSyncStatus = (): SyncStatus => useSyncExternalStore(sync.subscribe, sync.getStatus, sync.getStatus);
