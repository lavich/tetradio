import type { BridgeState } from "../platform/platform";
import { CARDS, dateTime, dayMonth, withCount } from "../shared/format";
import type { ConflictBranch, SyncStatus } from "./coordinator";

export const when = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : "—";

/** Строка версии в окне выбора: у облачной — когда отправлена; у обеих — последний ответ, а не время сборки снимка. */
export function branchLine(
  { local, createdAt, description }: Pick<ConflictBranch, "local" | "createdAt" | "description">,
  now = new Date(),
) {
  const last = description.lastAnswerAt
    ? `последний ответ ${dateTime(description.lastAnswerAt, now)}`
    : description.lastDay
      ? `последнее занятие ${dayMonth(description.lastDay)}`
      : null;
  const line = [
    !local && createdAt ? `отправлено ${dateTime(createdAt, now)}` : null,
    last,
    `${withCount(description.cards, CARDS)} в обучении`,
    withCount(description.answers, ["ответ", "ответа", "ответов"]),
  ]
    .filter(Boolean)
    .join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

export const syncPhaseText = (phase: string, lastConfirmedAt: string | null) =>
  ({
    disabled: "Только на этом устройстве",
    paused: "Синхронизация приостановлена",
    idle: "Сохранено на устройстве",
    syncing: "Синхронизация…",
    synced: `Синхронизировано${lastConfirmedAt ? ` · ${when(lastConfirmedAt)}` : ""}`,
    error: "Ошибка синхронизации",
    conflict: "Конфликт версий",
  })[phase] ?? phase;

export interface SyncLineState {
  phase: string;
  text: string;
  retry: boolean;
  failed: boolean;
}
/** Без bridge облака нет: пока он грузится или сорвался, фаза координатора о синхронизации ничего не говорит. */
export function syncLineState(
  status: SyncStatus,
  bridge: BridgeState,
  updating = false,
  onToday = false,
): SyncLineState {
  if (bridge === "slow") return { phase: "connecting", text: "Подключение к Telegram…", retry: false, failed: false };
  if (bridge === "failed")
    return {
      phase: "unavailable",
      text: "Синхронизация недоступна — перезапустите приложение",
      retry: false,
      failed: true,
    };
  if (updating && (status.error?.kind === "format" || status.error?.kind === "stale"))
    return {
      phase: "updating",
      text: onToday ? "Обновляем приложение…" : "Обновим приложение на экране «Сегодня»",
      retry: false,
      failed: false,
    };
  const dirty = status.dirty && status.phase !== "syncing" ? " · есть неотправленные изменения" : "";
  return {
    phase: status.phase,
    text: `${syncPhaseText(status.phase, status.lastConfirmedAt)}${dirty}`,
    retry: status.phase !== "disabled",
    failed: status.phase === "error" || status.phase === "paused",
  };
}
