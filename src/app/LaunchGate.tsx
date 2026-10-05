import { lazy, Suspense } from "react";
import { CONFIGURED_BOT } from "../platform/launch";
import ui from "../shared/ui.module.css";

export type LaunchStop = "outside-telegram" | "no-user" | "owner-mismatch";

const Landing = lazy(() => import("../features/landing/Landing"));

/** Рисуется вместо приложения до открытия базы: пользовательские данные не читаются и не пишутся. */
export function LaunchGate({ reason, bot = CONFIGURED_BOT }: { reason: LaunchStop; bot?: string | null }) {
  if (reason === "outside-telegram")
    return (
      <Suspense fallback={<div className="min-h-full bg-muted" aria-busy="true" />}>
        <Landing bot={bot} />
      </Suspense>
    );
  return (
    <div className={ui.app}>
      <main className={`${ui.screen} ${ui.roomy}`} data-testid="launch-error">
        <h1>Не удалось определить аккаунт</h1>
        <p className={ui.muted}>
          {reason === "no-user"
            ? "Telegram не передал сведения о пользователе"
            : "Сведения о пользователе от Telegram не совпали с этим запуском"}
          , поэтому Τετράδιο не открывает сохранённый прогресс и ничего не отправляет в облако. Закройте приложение и
          откройте его снова из чата с ботом.
        </p>
      </main>
    </div>
  );
}
