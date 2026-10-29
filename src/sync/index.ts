import { useSyncExternalStore } from "react";
import { installPackages } from "../content/client";
import { launchContext } from "../platform/launch";
import type { TelegramWebApp } from "../platform/telegram-types";
import { lifecycle, reportError } from "../reporting/reporting";
import { db } from "../storage/db";
import { currentProfile } from "../storage/profile";
import { storageHealer } from "../storage/recovery";
import { kvAdapter, loadCompression } from "./adapter";
import { afterFirstExchange } from "./warm";
import { syncFailureReporter } from "./failure";
import { SyncCoordinator, webLock, type SyncStatus, webLockWait } from "./coordinator";
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
  lock: webLock(`tetradio-sync-${db.name}`),
  exclusive: webLockWait(`tetradio-sync-${db.name}`),
  recover: heal,
});
sync.onMissingPackages = (ids) => {
  installPackages(ids).catch((error: unknown) => reportError(error, { category: "content" }));
};
// Модуль автообновления живёт в основном чанке: событие не тянет его зависимости в чанк синхронизации.
sync.onNewerFormat = () => window.dispatchEvent(new CustomEvent("tetradio:newer-format"));
const report = syncFailureReporter((error, kind) => reportError(error, { category: "sync", extra: { kind } }));
sync.onFailure = (error, kind) => {
  // Удалённый чанк старой сборки лечит перезагрузка, а не разбор отчёта: повторы шли бы отчётом каждый раз.
  if (kind === "stale") lifecycle("syncStaleChunk");
  else report(error, kind);
};

export function connectSync(app: TelegramWebApp | null) {
  const profile = currentProfile();
  // Telegram ниже 6.9 отдаёт CloudStorage, но каждый вызов бросает исключение: это клиент без облака, а не сбой.
  if (
    !profile.syncable ||
    !app?.CloudStorage ||
    typeof app.CloudStorage.getItems !== "function" ||
    !app.isVersionAtLeast("6.9")
  ) {
    if (profile.kind === "telegram") sync.setAdapter(kvAdapter(disabledTransport()));
    return;
  }
  sync.setAdapter(kvAdapter(cloudStorageTransport(app.CloudStorage)));
  sync.setBackground((listener) => {
    try {
      app.onEvent("deactivated", listener);
      return () => app.offEvent("deactivated", listener);
    } catch {
      return () => undefined;
    }
  });
  afterFirstExchange(
    sync,
    () => void loadCompression().catch(() => undefined),
    (task) =>
      typeof requestIdleCallback === "function" ? requestIdleCallback(task, { timeout: 10000 }) : setTimeout(task, 0),
  );
  sync.start();
}
export const useSyncStatus = (): SyncStatus => useSyncExternalStore(sync.subscribe, sync.getStatus, sync.getStatus);

// Удаление данных берёт эти части отсюда: прямой импорт вынес бы координатор в отдельный чанк первого экрана.
export { removeAllKeys } from "./adapter";
export { LockTimeout } from "./coordinator";
export { cloudStorageTransport, SyncError, type KeyValueTransport } from "./transport";
