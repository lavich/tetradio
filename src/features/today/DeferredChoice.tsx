import { sync, useSyncStatus } from "../../sync";
import css from "./today.module.css";

/** Пока выбор версии отложен, прогресс этого устройства не публикуется: строка не даёт об этом забыть. */
export function DeferredChoice() {
  const status = useSyncStatus();
  if (status.phase !== "conflict" || !status.conflict?.deferred) return null;
  return (
    <button
      type="button"
      className={css.quiet}
      aria-haspopup="dialog"
      data-testid="sync-deferred"
      onClick={() => void sync.reviewChoice()}
    >
      Прогресс не сохраняется в облако — выберите версию
    </button>
  );
}
