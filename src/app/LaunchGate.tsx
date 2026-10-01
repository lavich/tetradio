import { buttonVariants } from "@/components/ui/button";
import { CONFIGURED_BOT } from "../platform/launch";
import ui from "../shared/ui.module.css";

export type LaunchStop = "outside-telegram" | "no-user" | "owner-mismatch";

/** Рисуется вместо приложения до открытия базы: пользовательские данные не читаются и не пишутся. */
export function LaunchGate({ reason, bot = CONFIGURED_BOT }: { reason: LaunchStop; bot?: string | null }) {
  const outside = reason === "outside-telegram";
  return (
    <div className={ui.app}>
      <main className={`${ui.screen} ${ui.roomy}`} data-testid={outside ? "open-in-telegram" : "launch-error"}>
        <p className={ui.eyebrow} lang="el">
          τετράδιο
        </p>
        <h1>{outside ? "Откройте в Telegram" : "Не удалось определить аккаунт"}</h1>
        {outside ? (
          <>
            <p className={ui.muted}>
              Τετράδιο работает внутри Telegram: прогресс курса хранится в вашем аккаунте и переходит между устройствами
              без отдельной регистрации.
            </p>
            {bot ? (
              <a className={`${buttonVariants({ size: "xl" })} mt-4`} href={`https://t.me/${bot}`}>
                Открыть @{bot}
              </a>
            ) : (
              <p className={`${ui.note} mt-4`}>Найдите бота курса в Telegram и откройте приложение из него.</p>
            )}
          </>
        ) : (
          <p className={ui.muted}>
            {reason === "no-user"
              ? "Telegram не передал сведения о пользователе"
              : "Сведения о пользователе от Telegram не совпали с этим запуском"}
            , поэтому Τετράδιο не открывает сохранённый прогресс и ничего не отправляет в облако. Закройте приложение и
            откройте его снова из чата с ботом.
          </p>
        )}
      </main>
    </div>
  );
}
