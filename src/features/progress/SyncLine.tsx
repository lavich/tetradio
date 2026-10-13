import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBridgeState } from "../../platform/platform";
import { currentProfile } from "../../storage/profile";
import { sync, useSyncStatus } from "../../sync";
import { syncLineState } from "../../sync/status-text";
import ui from "../../shared/ui.module.css";
import css from "./progress.module.css";

/** Сохранён ли прогресс: одна строка статуса и повтор, если синхронизация не прошла. */
export function SyncLine() {
  const profile = currentProfile();
  const status = useSyncStatus();
  const bridge = useBridgeState();
  if (profile.kind !== "telegram") return <p className={css.status}>Данные хранятся только в этом браузере</p>;
  const line = syncLineState(status, bridge);
  return (
    <>
      <div className={css.status} data-testid="sync-status" data-phase={line.phase}>
        <span>{line.text}</span>
        {line.retry && (
          <Button
            size="sm"
            variant={line.failed ? "soft" : "quiet"}
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
