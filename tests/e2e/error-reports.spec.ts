import { expect, test } from "@playwright/test";
import { ready } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
});

test("переключатель отчётов включён по умолчанию, выключение переживает перезагрузку страницы", async ({ page }) => {
  await page.goto("/more/settings");
  const toggle = page.getByRole("switch", { name: "Отправлять отчёты об ошибках" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId("error-reports-status")).toHaveText("Отчёты выключены, накопленная очередь удалена.");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Отправлять отчёты об ошибках" })).not.toBeChecked();
  // Обратно: включение тоже сохраняется.
  await page.getByRole("switch", { name: "Отправлять отчёты об ошибках" }).check();
  await expect(page.getByTestId("error-reports-status")).toHaveText("Отчёты включены.");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Отправлять отчёты об ошибках" })).toBeChecked();
});

test("экран «Копия данных» описывает канал отчётов: куда, что, чего нет и где выключить", async ({ page }) => {
  await page.goto("/more/backup");
  const boundaries = page.getByTestId("error-reports-boundaries");
  await expect(boundaries).toBeVisible();
  await expect(boundaries).toContainText("Sentry");
  await expect(boundaries).toContainText("тип ошибки и стек");
  await expect(boundaries).toContainText("не попадают слова, переводы");
  await expect(boundaries).toContainText("идентификатор и имя пользователя Telegram");
  await expect(boundaries).toContainText("Без сети отчёт ждёт на устройстве");
  await expect(boundaries).toContainText("«Настройках» переключателем «Отправлять отчёты об ошибках»");
});
