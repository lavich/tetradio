import ui from "../shared/ui.module.css";

export type LaunchStop = "outside-telegram" | "no-user" | "owner-mismatch";

/** Рисуется вместо приложения до открытия базы: пользовательские данные не читаются и не пишутся. */
export function LaunchGate({ reason }: { reason: Exclude<LaunchStop, "outside-telegram"> }) {
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
