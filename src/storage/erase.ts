import { cloudStorageTransport, LockTimeout, removeAllKeys, SyncError, type KeyValueTransport } from "../sync";
import { skipStartRouteOnReload } from "../platform/launch";
import type { TelegramWebApp } from "../platform/telegram-types";
import type { SendResult } from "../platform/feedback-send";
import { clearReportQueue } from "../reporting/reporting";
import type { AppDatabase } from "./db";
import { deleteDatabase } from "./delete-database";
import { clearErase, markErase, type ErasePhase } from "./erase-marker";
import type { Profile } from "./profile";

export type EraseReason = "messages" | "waitlist" | "stale" | "unavailable" | "cloud" | "busy";
export class EraseFailure extends Error {
  constructor(
    readonly reason: EraseReason,
    readonly messagesGone: boolean,
  ) {
    super(reason);
  }
}

interface Halting {
  halt(work: () => Promise<void>): Promise<void>;
  resume(): void;
}
export interface EraseDeps {
  database: AppDatabase;
  profile: Profile;
  bridge(): TelegramWebApp | null;
  sync(): Promise<Halting>;
  forget(): Promise<SendResult>;
  /** Есть, когда доступна форма «Написать автору»: заявки на курсы удаляются и без отметки переписки. */
  leaveWaitlist?(): Promise<SendResult>;
  transport?(app: TelegramWebApp): KeyValueTransport;
  showErasing(message: string): void;
  reload(): void;
}

export const FINISHING = "Завершаем удаление данных…";
export const BLOCKED_ERASE = "Закройте другие окна приложения и перезапустите — удаление завершится при запуске.";

/** Та же проверка, что `capabilities.cloudStorage`: в клиенте до Bot API 6.9 метод есть, но бросает исключение. */
const cloudOf = (app: TelegramWebApp | null) =>
  app?.CloudStorage && typeof app.CloudStorage.getItems === "function" && app.isVersionAtLeast("6.9")
    ? app.CloudStorage
    : null;

/** Удаление необратимо: облако чужого аккаунта или облако без подтверждённого владельца не трогается. */
export function eraseCloud(deps: EraseDeps): (() => Promise<void>) | null | "unavailable" {
  if (deps.profile.kind !== "telegram") return null;
  const app = deps.bridge();
  const cloud = cloudOf(app);
  if (!cloud || app?.initDataUnsafe.user?.id !== deps.profile.userId) return "unavailable";
  const transport = deps.transport ? deps.transport(app) : cloudStorageTransport(cloud);
  return () => removeAllKeys(transport);
}

const failureOf = (error: unknown): EraseReason =>
  error instanceof LockTimeout
    ? "busy"
    : error instanceof SyncError && error.kind === "unavailable"
      ? "unavailable"
      : "cloud";

/**
 * В этой вкладке удаляются только переписка и облако; устройство очищается при следующем запуске (`resumeErase`):
 * открытые здесь соединения — SDK отчётов никогда не закрывает свою базу — не дали бы удалить базы.
 */
export async function eraseMyData(withMessages: boolean, deps: EraseDeps): Promise<void> {
  const cloud = eraseCloud(deps);
  if (cloud === "unavailable") throw new EraseFailure("unavailable", false);
  if (withMessages) {
    const result = await deps.forget();
    if (result !== "ok") throw new EraseFailure(result === "stale" ? "stale" : "messages", false);
  } else if (deps.leaveWaitlist) {
    const result = await deps.leaveWaitlist();
    if (result !== "ok") throw new EraseFailure(result === "stale" ? "stale" : "waitlist", false);
  }
  let sync: Halting;
  try {
    sync = await deps.sync();
  } catch {
    throw new EraseFailure("cloud", withMessages);
  }
  const name = deps.database.name;
  try {
    await sync.halt(async () => {
      markErase(name, "cloud");
      await cloud?.();
      markErase(name, "local");
    });
  } catch (error) {
    try {
      clearErase(name);
    } finally {
      sync.resume();
    }
    throw new EraseFailure(failureOf(error), withMessages);
  }
  deps.showErasing(FINISHING);
  skipStartRouteOnReload();
  deps.reload();
}

const LOCAL_KEYS = ["tetradio:feedback-draft", "word-taps-hint"];

/** Контекст запуска и параметры моста (`__telegram__*`) остаются: без них после перезагрузки нет ни аккаунта, ни облака. */
async function finishLocal(deps: Pick<EraseDeps, "database" | "reload">): Promise<void> {
  await clearReportQueue();
  deps.database.close({ disableAutoOpen: true });
  await deleteDatabase(deps.database.name);
  await deleteDatabase("tetradio-restore");
  for (const key of [`tetradio:haptics:${deps.database.name}`, ...LOCAL_KEYS]) localStorage.removeItem(key);
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith("scroll:") || key === "tetradio:sw-dropped") sessionStorage.removeItem(key);
  clearErase(deps.database.name);
  skipStartRouteOnReload();
  deps.reload();
}

export async function resumeErase(
  phase: ErasePhase,
  deps: EraseDeps & { ready(): Promise<unknown>; showChoice(): void },
): Promise<void> {
  deps.showErasing(FINISHING);
  const ready = deps.ready();
  if (phase === "cloud") {
    await ready;
    const cloud = eraseCloud(deps);
    try {
      if (cloud === "unavailable") throw new Error("unavailable");
      await cloud?.();
      markErase(deps.database.name, "local");
    } catch {
      deps.showChoice();
      return;
    }
  }
  try {
    await finishLocal(deps);
  } catch {
    deps.showErasing(BLOCKED_ERASE);
  }
}
