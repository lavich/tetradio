import { useEffect, useRef, useState } from "react";
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

/** Единственный канал, по которому что-то покидает устройство помимо синхронизации: описывается так же явно. */
export const REPORT_BOUNDARIES =
  "Отчёты об ошибках уходят в сервис учёта ошибок Sentry: тип ошибки и стек, версия приложения и сборки, среда запуска (веб или Telegram) с версией клиента, путь экрана без параметров и события сворачивания Mini App с размерами окна. В отчёт не попадают слова, переводы, примеры, ответы, прогресс, содержимое базы и снимков, идентификатор и имя пользователя Telegram, данные запуска и сообщения консоли; IP-адрес не сохраняется. Без сети отчёт ждёт на устройстве в отдельном хранилище и уходит при следующем запуске; в полную копию он не входит. Выключается в «Настройках» переключателем «Отправлять отчёты об ошибках» — сразу и насовсем, очередь при этом удаляется. Единственное исключение — отчёт о том, что не открылась сама база: настройку в этот момент прочитать нельзя, и он уходит по умолчанию.";
import { useAction } from "../../shared/action";
import { megabytes } from "../../shared/offline";
import { db } from "../../storage/db";
import { currentProfile } from "../../storage/profile";
import css from "../progress/settings.module.css";
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
import { CloudChangedError, cloudPrint } from "./cloud-check";
import ui from "../../shared/ui.module.css";

const handedOver = (outcome: TransferOutcome) => outcome === "shared" || outcome === "downloaded";

/** Копия и восстановление — раздел экрана «Настройки и данные». */
export function BackupSection() {
  const input = useRef<HTMLInputElement>(null);
  const profile = currentProfile();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<BackupReport | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
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
    setStale(false);
    setFile(picked ?? null);
    if (!picked) return;
    const [checked, print] = await Promise.all([inspectBackup(picked), cloudPrint(sync.adapter, db)]);
    setSeen(print);
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
        const guard = await send(await exportFull(), `tetradio-before-restore-${Date.now()}.json`);
        if (!handedOver(guard))
          return setProblem(`Замена отменена: защитная копия не передана (${TRANSFER_TEXT[guard].toLowerCase()})`);
        await restoreBackup(file, db, { cloud: { seen, read: () => cloudPrint(sync.adapter, db) } });
        setStatus("Данные восстановлены полностью.");
      },
      (error) => {
        if (error instanceof CloudChangedError) {
          setReport(null);
          setStale(true);
        }
        return error instanceof Error
          ? `${error.message} Текущие данные остались без изменений.`
          : "Восстановление не удалось, данные не изменены.";
      },
    );
  };
  return (
    <section aria-labelledby="copy" className={css.section}>
      <h2 id="copy" className={css.heading}>
        Копия
      </h2>
      <p className={css.note}>Файл со всеми данными: уроки, ответы, повторения и настройки.</p>
      <div className={css.actions}>
        <Button
          size="md"
          onClick={() =>
            run(async () => {
              await send(await exportFull(), backupName());
            })
          }
          disabled={busy}
        >
          Сохранить полную копию
        </Button>
        <Button variant="soft" size="md" onClick={() => input.current?.click()} disabled={busy}>
          Восстановить из копии…
        </Button>
        <input
          ref={input}
          id="backup"
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Файл полной копии"
          onChange={(event) => pick(event.target.files?.[0])}
        />
      </div>
      {transfer && (
        <p className={css.note} role="status" data-testid="transfer-status">
          {transfer}
        </p>
      )}
      {report && (
        <div className={css.report}>
          <p>
            Файл проверен: база «{report.databaseName}», {megabytes(report.bytes)}
            {report.createdAt ? `, копия от ${new Date(report.createdAt).toLocaleString("ru-RU")}` : ""}.
            {report.legacy ? " Копия прежней версии: при восстановлении она будет обновлена до текущей." : ""}
          </p>
          <p className={css.note}>{report.tables.map((table) => `${table.name}: ${table.rows}`).join(" · ")}</p>
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" size="md" disabled={busy}>
                  Заменить данные копией
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Заменить все данные на этом устройстве?</AlertDialogTitle>
                <AlertDialogDescription>
                  Текущие слова, прогресс, ответы и настройки будут перезаписаны содержимым копии. Перед заменой
                  Τετράδιο передаст текущие данные отдельным файлом; если передача отменится, замена не начнётся.
                  {profile.kind === "telegram"
                    ? " Облачный прогресс Telegram не откатится молча: после восстановления Τετράδιο предложит выбрать, с какой версии продолжить."
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
        </div>
      )}
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
      {stale && file && (
        <Button variant="soft" size="md" className="mt-3" disabled={busy} onClick={() => pick(file)}>
          Открыть предпросмотр заново
        </Button>
      )}
      {status && (
        <p className={css.note} role="status" style={{ color: "var(--ok)" }}>
          {status}
        </p>
      )}
      {stored.length > 0 && (
        <div className={css.stored} data-testid="stored-versions">
          <h3 className={css.subheading}>Отложенные версии облака</h3>
          <p className={css.note}>
            Версии, отвергнутые при выборе в конфликте. Хранятся на этом устройстве до удаления.
          </p>
          {stored.map((row) => (
            <div key={row.id} className={css.storedRow}>
              <p>
                {row.note ?? row.role} · {new Date(row.createdAt).toLocaleString("ru-RU")} ·{" "}
                {row.snapshot.states.length} слов, {row.snapshot.stats.answers} ответов
              </p>
              <div className={css.actions}>
                <Button
                  size="sm"
                  variant="soft"
                  onClick={async () => {
                    const blob = await sync.exportStored(row.id);
                    if (blob) await send(blob, `tetradio-version-${row.id}.json`);
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
      )}
      <button
        type="button"
        className={css.link}
        onClick={async () => send(await exportWordsTsv(), "tetradio-words.tsv")}
      >
        Слова курса в TSV — для других приложений
      </button>
    </section>
  );
}
