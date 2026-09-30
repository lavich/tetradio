import { useState } from "react";
import { Button } from "@/components/ui/button";
import { launchContext } from "../platform/launch";
import { APP_BUILD, APP_VERSION } from "../reporting/reporting";
import ui from "../shared/ui.module.css";

/**
 * Диагностика для пользователя: версия, среда, время, идентификатор отчёта и тип ошибки.
 * Сообщение ошибки не включается — диагностика по построению не содержит учебных данных.
 */
export function diagnostics(error: unknown, reportId: string | null, at: Date = new Date()): string {
  const launch = launchContext();
  const env =
    launch.kind === "telegram"
      ? `Telegram${launch.platform ? ` ${launch.platform}` : ""}${launch.version ? ` ${launch.version}` : ""}`
      : "веб";
  const kind = error instanceof Error ? error.name : typeof error;
  return [
    `Lexi ${APP_VERSION} (${APP_BUILD})`,
    `Среда: ${env}`,
    `Время: ${at.toISOString()}`,
    `Отчёт: ${reportId ?? "не отправлен"}`,
    `Ошибка: ${kind}`,
  ].join("\n");
}

interface Props {
  title: string;
  description: string;
  error: unknown;
  reportId: string | null;
  testId: string;
}
/** Экран сбоя вместо пустого экрана: объяснение, перезапуск и диагностика для копирования. Ничего не пишет в базу. */
export function CrashScreen({ title, description, error, reportId, testId }: Props) {
  // Время фиксируется при появлении экрана, идентификатор отчёта граница ошибок дописывает чуть позже — текст собирается при копировании.
  const [at] = useState(() => new Date());
  const [copied, setCopied] = useState<"idle" | "done" | "manual">("idle");
  const text = diagnostics(error, reportId, at);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("manual");
    } // WebView без буфера обмена: текст показывается для ручного копирования
  };
  return (
    <div className={ui.app}>
      <main className={`${ui.screen} ${ui.roomy}`} data-testid={testId}>
        <h1 className="text-2xl font-semibold mb-2">{title}</h1>
        <p className={ui.muted}>{description}</p>
        <Button size="xl" className="mt-4" onClick={() => location.reload()}>
          Перезапустить
        </Button>
        <Button size="xl" variant="outline" className="mt-2" onClick={copy}>
          Скопировать диагностику
        </Button>
        {copied === "done" && (
          <p className={`${ui.small} mt-2`} role="status" style={{ color: "var(--ok)" }}>
            Диагностика скопирована.
          </p>
        )}
        {copied === "manual" && (
          <pre className={`${ui.note} mt-2 whitespace-pre-wrap`} data-testid="diagnostics">
            {text}
          </pre>
        )}
      </main>
    </div>
  );
}
