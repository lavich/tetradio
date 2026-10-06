import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncPhaseText } from "../../app/TelegramNotices";
import { currentProfile } from "../../storage/profile";
import { sync, useSyncStatus } from "../../sync";
import ui from "../../shared/ui.module.css";
import css from "./progress.module.css";

/** Сохранён ли прогресс: одна строка статуса и повтор, если синхронизация не прошла. */
export function SyncLine() {
  const profile = currentProfile();
  const status = useSyncStatus();
  if (profile.kind !== "telegram") return <p className={css.status}>Данные хранятся только в этом браузере</p>;
  const failed = status.phase === "error" || status.phase === "paused";
  return (
    <>
      <div className={css.status} data-testid="sync-status" data-phase={status.phase}>
        <span>
          {syncPhaseText(status.phase, status.lastConfirmedAt)}
          {status.dirty && status.phase !== "syncing" ? " · есть неотправленные изменения" : ""}
        </span>
        {status.phase !== "disabled" && (
          <Button
            size="sm"
            variant={failed ? "soft" : "quiet"}
            disabled={status.phase === "syncing"}
            onClick={() => void sync.exchange()}
            aria-label="Повторить синхронизацию"
          >
            <RefreshCw data-icon="inline-start" />
            Повторить
          </Button>
        )}
      </div>
      {status.error && <p className={ui.error}>{status.error.message}</p>}
      {status.reason && <p className={css.statusNote}>{status.reason}</p>}
    </>
  );
}
