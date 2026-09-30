import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Screen } from "../../app/Screen";
import { SYNC_BOUNDARIES } from "../../app/TelegramNotices";

/** Единственный канал, по которому что-то покидает устройство помимо синхронизации: описывается так же явно. */
export const REPORT_BOUNDARIES =
  "Отчёты об ошибках уходят в сервис учёта ошибок Sentry: тип ошибки и стек, версия приложения и сборки, среда запуска (веб или Telegram) с версией клиента, путь экрана без параметров и события сворачивания Mini App с размерами окна. В отчёт не попадают слова, переводы, примеры, ответы, прогресс, содержимое базы и снимков, идентификатор и имя пользователя Telegram, данные запуска и сообщения консоли; IP-адрес не сохраняется. Без сети отчёт ждёт на устройстве в отдельном хранилище и уходит при следующем запуске; в полную копию он не входит. Выключается в «Настройках» переключателем «Отправлять отчёты об ошибках» — сразу и насовсем, очередь при этом удаляется. Единственное исключение — отчёт о том, что не открылась сама база: настройку в этот момент прочитать нельзя, и он уходит по умолчанию.";
import { useAction } from "../../shared/action";
import { megabytes } from "../../shared/offline";
import { currentProfile } from "../../storage/profile";
import { sync } from "../../sync";
import type { SyncVersionRow } from "../../sync/types";
import {
  backupName,
  exportFull,
  exportWordsTsv,
  inspectBackup,
  restoreBackup,
  transferFile,
  TRANSFER_TEXT,
  type BackupReport,
  type TransferOutcome,
} from "./backup";
import ui from "../../shared/ui.module.css";

const handedOver = (outcome: TransferOutcome) => outcome === "shared" || outcome === "downloaded";

export function BackupScreen() {
  const profile = currentProfile();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<BackupReport | null>(null);
  const { busy, problem, setProblem, run } = useAction("Восстановление не удалось, данные не изменены.");
  const [status, setStatus] = useState("");
  const [transfer, setTransfer] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [stored, setStored] = useState<SyncVersionRow[]>([]);
  const refreshStored = () =>
    sync
      .listStored()
      .then(setStored)
      .catch(() => setStored([]));
  useEffect(() => {
    void refreshStored();
  }, []);

  const pick = async (picked: File | undefined) => {
    setReport(null);
    setProblem("");
    setStatus("");
    setFile(picked ?? null);
    if (!picked) return;
    const checked = await inspectBackup(picked);
    if (checked.ok) setReport(checked.report);
    else setProblem(checked.message);
  };
  const send = async (blob: Blob, name: string) => {
    const outcome = await transferFile(blob, name);
    setTransfer(TRANSFER_TEXT[outcome]);
    return outcome;
  };
  const restore = () => {
    if (!file || !report) return;
    setStatus("");
    return run(
      async () => {
        // Защитная копия обязана уйти до замены: отмена или ошибка передачи останавливают восстановление.
        const guard = await send(await exportFull(), `lexi-before-restore-${Date.now()}.json`);
        if (!handedOver(guard))
          return setProblem(`Замена отменена: защитная копия не передана (${TRANSFER_TEXT[guard].toLowerCase()})`);
        await restoreBackup(file);
        setStatus("Данные восстановлены полностью.");
      },
      (error) =>
        error instanceof Error
          ? `${error.message} Текущие данные остались без изменений.`
          : "Восстановление не удалось, данные не изменены.",
    );
  };
  return (
    <Screen back="Копия данных">
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Полная копия</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={ui.note}>
            Слова, наборы и их связи, скачанные картинки и аудио, версии установленных уроков и ваши правки, прогресс
            FSRS, ответы, сессии и настройки. Этот файл переносит всё
            {profile.kind === "telegram" ? ", в том числе между Telegram и обычным браузером" : ""}.
          </p>
          {profile.kind === "telegram" && (
            <p className={ui.note} data-testid="sync-boundaries">
              {SYNC_BOUNDARIES}
            </p>
          )}
          <p className={ui.note} data-testid="error-reports-boundaries">
            {REPORT_BOUNDARIES}
          </p>
          <Button
            size="xl"
            onClick={() =>
              run(async () => {
                await send(await exportFull(), backupName());
              })
            }
            disabled={busy}
          >
            Сохранить полную копию
          </Button>
          {transfer && (
            <p className={ui.small} role="status" data-testid="transfer-status">
              {transfer}
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Только слова (TSV)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={ui.note}>
            Греческий, перевод и IPA для переноса в другие приложения. Прогресс обучения в этот файл не входит.
          </p>
          <Button variant="soft" size="xl" onClick={async () => send(await exportWordsTsv(), "lexi-words.tsv")}>
            Сохранить TSV
          </Button>
        </CardContent>
      </Card>
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Восстановление</CardTitle>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="backup">Файл полной копии</FieldLabel>
            <Input
              id="backup"
              type="file"
              accept="application/json,.json"
              onChange={(event) => pick(event.target.files?.[0])}
            />
          </Field>
          {report && (
            <div className={ui.small} style={{ marginTop: 10 }}>
              <p style={{ margin: "0 0 4px" }}>
                Файл проверен: база «{report.databaseName}», {megabytes(report.bytes)}
                {report.createdAt ? `, копия от ${new Date(report.createdAt).toLocaleString("ru-RU")}` : ""}.
                {report.legacy
                  ? " Копия старого формата: наборы будут преобразованы в связи без скачивания пакетов."
                  : ""}
              </p>
              <p className={ui.muted} style={{ margin: 0 }}>
                {report.tables.map((table) => `${table.name}: ${table.rows}`).join(" · ")}
              </p>
            </div>
          )}
          {problem && (
            <p className={ui.error} role="alert">
              {problem}
            </p>
          )}
          {status && (
            <p className={ui.small} role="status" style={{ color: "var(--ok)" }}>
              {status}
            </p>
          )}
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" size="xl" className="mt-3" disabled={!report || busy}>
                  Заменить данные копией
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Заменить все данные на этом устройстве?</AlertDialogTitle>
                <AlertDialogDescription>
                  Текущие слова, прогресс, ответы и настройки будут перезаписаны содержимым копии. Перед заменой Lexi
                  передаст текущие данные отдельным файлом; если передача отменится, замена не начнётся.
                  {profile.kind === "telegram"
                    ? " Облачный прогресс Telegram не откатится молча: после восстановления Lexi предложит выбрать, с какой версии продолжить."
                    : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirming(false);
                    void restore();
                  }}
                >
                  Заменить
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <p className={ui.note}>Перед заменой Lexi передаст текущие данные отдельным файлом.</p>
        </CardContent>
      </Card>
      {stored.length > 0 && (
        <Card className="mb-3" data-testid="stored-versions">
          <CardHeader>
            <CardTitle>Отложенные версии облака</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={ui.note}>
              Версии, отвергнутые при выборе в конфликте. Хранятся на устройстве до удаления вручную; сначала можно
              сохранить файл.
            </p>
            <div className={ui.stack}>
              {stored.map((row) => (
                <div key={row.id} className="rounded-[14px] border border-border p-3">
                  <p className="m-0 text-sm">
                    {row.note ?? row.role} · {new Date(row.createdAt).toLocaleString("ru-RU")} ·{" "}
                    {row.snapshot.states.length} слов, {row.snapshot.stats.answers} ответов
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="soft"
                      onClick={async () => {
                        const blob = await sync.exportStored(row.id);
                        if (blob) await send(blob, `lexi-version-${row.id}.json`);
                      }}
                    >
                      Сохранить файл
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={async () => {
                        await sync.discardStored(row.id);
                        await refreshStored();
                      }}
                    >
                      Удалить
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </Screen>
  );
}
