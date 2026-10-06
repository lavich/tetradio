import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { sync, useSyncStatus } from "../sync";
import { readMeta } from "../sync/snapshot";
import { CARDS, withCount } from "../shared/format";
import ui from "../shared/ui.module.css";

const when = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : "—";
/**
 * Конфликт независимых версий: пользователь выбирает целую версию. Выбор не объединяет ответы другой версии,
 * отвергнутая версия сохраняется на устройстве и доступна для копии на экране «Настройки и данные».
 */
export function SyncConflictDialog() {
  const status = useSyncStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const conflict = status.conflict;
  if (!conflict || status.phase !== "conflict") return null;
  const key = conflict.branches.map((branch) => branch.id).join("|");
  if (dismissed === key) return null;
  const titles = {
    diverged: "Прогресс разошёлся между устройствами",
    initial: "В облаке уже есть прогресс",
    restored: "Копия восстановлена, в облаке другой прогресс",
    remote: "Два устройства изменили прогресс независимо",
  };
  const choose = async (id: string) => {
    setBusy(id);
    try {
      await sync.resolve(id);
    } finally {
      setBusy(null);
    }
  };
  return (
    <AlertDialog open>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{titles[conflict.kind]}</AlertDialogTitle>
          <AlertDialogDescription>
            Выберите версию целиком, чтобы продолжить с неё на всех устройствах. Ответы другой версии в неё не
            добавятся; она сохранится на этом устройстве, и её можно будет скачать на экране «Настройки и данные». До
            выбора занятия продолжаются, синхронизация не считается успешной.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className={ui.stack} role="list">
          {conflict.branches.map((branch) => (
            <div key={branch.id} role="listitem" className="rounded-[14px] border border-border p-3">
              <p className="m-0 font-semibold">{branch.label}</p>
              <p className="m-0 text-sm text-muted-foreground">
                {when(branch.createdAt)} · {withCount(branch.description.cards, CARDS)} в обучении ·{" "}
                {withCount(branch.description.answers, ["ответ", "ответа", "ответов"])}
                {branch.description.lastDay ? ` · последнее занятие ${branch.description.lastDay}` : ""}
              </p>
              <Button
                size="md"
                className="mt-2"
                variant={branch.local ? "default" : "soft"}
                disabled={!!busy}
                onClick={() => choose(branch.id)}
              >
                {busy === branch.id ? "Применяем…" : `Продолжить с этой версии`}
              </Button>
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <Button
            variant="quiet"
            size="md"
            className="sm:w-auto"
            disabled={saving || !!busy}
            onClick={async () => {
              setSaving(true);
              try {
                const { transferFile, backupName, exportFull } = await import("../features/backup/backup");
                await transferFile(await exportFull(), backupName());
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Готовим копию…" : "Сначала сохранить полную копию"}
          </Button>
          <AlertDialogCancel size="md" className="sm:w-auto" onClick={() => setDismissed(key)}>
            Решить позже
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
/** Заглушка, чтобы у экрана копий и «Ещё» был общий текст статуса. */
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
export { readMeta };
