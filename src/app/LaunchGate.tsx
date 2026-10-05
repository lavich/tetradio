import { lazy, Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { CONFIGURED_BOT } from "../platform/launch";
import ui from "../shared/ui.module.css";

export type LaunchStop = "outside-telegram" | "no-user" | "owner-mismatch";

const Landing = lazy(() => import("../features/landing/Landing"));

function OpenInTelegram({ bot }: { bot: string | null }) {
  return (
    <div className={ui.app}>
      <main className={`${ui.screen} ${ui.roomy}`}>
        <h1>Τετράδιο — курс греческого к A2</h1>
        {bot ? (
          <a className={`${buttonVariants({ size: "xl" })} mt-4`} href={`https://t.me/${bot}`}>
            Открыть в Telegram
          </a>
        ) : (
          <p className={`${ui.note} mt-4`}>Найдите бота курса в Telegram и откройте приложение из него.</p>
        )}
      </main>
    </div>
  );
}

/** Рисуется вместо приложения до открытия базы: пользовательские данные не читаются и не пишутся. */
export function LaunchGate({ reason, bot = CONFIGURED_BOT }: { reason: LaunchStop; bot?: string | null }) {
  if (reason === "outside-telegram")
    return (
      <Suspense fallback={<OpenInTelegram bot={bot} />}>
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
