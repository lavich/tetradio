import { useEffect, useRef, useState } from "react";
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
import { branchLine } from "../sync/status-text";
import ui from "../shared/ui.module.css";

/**
 * Конфликт независимых версий: пользователь выбирает целую версию. Выбор не объединяет ответы другой версии,
 * отвергнутая версия сохраняется на устройстве и доступна для копии на экране «Настройки и данные».
 */
export function SyncConflictDialog() {
  const status = useSyncStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hidden, setHidden] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);
  const conflict = status.conflict;
  const key = conflict?.branches.map((branch) => branch.id).join("|") ?? null;
  // Отложенный выбор записан на устройстве: дальше окно прячет он, а «Выбрать версию» открывает снова.
  useEffect(() => {
    if (conflict?.deferred) setHidden(null);
  }, [conflict?.deferred]);
  // Кнопка выбранной ветви исчезает вместе с ней, и фокус ушёл бы на body.
  useEffect(() => {
    if (!key || busy) return;
    if (focused.current && focused.current !== key) list.current?.querySelector("button")?.focus();
    focused.current = key;
  }, [key, busy]);
  if (!conflict || !key || status.phase !== "conflict" || conflict.deferred || hidden === key) return null;
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
      returnFocus();
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
          <p role="status" className={status.reason ? ui.note : "sr-only"}>
            {status.reason ?? ""}
          </p>
        </AlertDialogHeader>
        <div ref={list} className={ui.stack} role="list">
          {conflict.branches.map((branch) => (
            <div key={branch.id} role="listitem" className="rounded-[14px] border border-border p-3">
              <p className="m-0 font-semibold">{branch.label}</p>
              <p className="m-0 text-sm text-muted-foreground">{branchLine(branch)}</p>
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
          <AlertDialogCancel
            size="md"
            className="sm:w-auto"
            onClick={() => {
              setHidden(key);
              sync.dismissChoice();
              const ids = conflict.branches.filter((branch) => !branch.local).map((branch) => branch.id);
              // Без записи окно скрыто до перезапуска, как раньше: выбор от сбоя хранилища не теряется.
              sync.deferChoice(ids).catch((error: unknown) => console.warn("«Решить позже» не сохранено", error));
              returnFocus();
            }}
          >
            Решить позже
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
/** Окно исчезает целиком, а кнопки, открывшей его, может уже не быть: фокус — на строку статуса синхронизации. */
const returnFocus = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-testid=sync-status]")?.focus());
export { readMeta };
