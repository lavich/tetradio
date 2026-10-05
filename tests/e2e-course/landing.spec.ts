import { expect, test } from "@playwright/test";

/** `/web/` — сборка курса-демо без мока Telegram: статичный лендинг с пробным уроком из урока 1.1. */
test("пробный урок на статичном лендинге: ответы, строки сделанного, итог и повтор; база и service worker не создаются", async ({
  page,
}) => {
  await page.goto("/web/");
  const sheet = page.locator("form.lp-sheet:not([hidden])");
  const rows = page.locator("[data-row]");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Греческий с нуля до экзамена A2");
  await expect(rows).toHaveCount(4);

  await sheet.getByRole("button").first().click();
  await expect(sheet.locator(".lp-okLine, .lp-penLine")).toBeVisible();
  await expect(sheet.locator(".lp-option[disabled]")).toHaveCount(await sheet.locator(".lp-option").count());
  await sheet.getByRole("button", { name: "Далее ›" }).click();

  const input = sheet.getByLabel("Ваш ответ");
  await expect(input).toBeFocused();
  await expect(sheet.getByRole("button", { name: "Проверить" })).toBeDisabled();
  await input.fill("λάθος");
  await page.keyboard.press("Enter");
  await expect(sheet.locator(".lp-penLine")).toContainText("правильно:");
  await expect(rows.nth(1).locator("s")).toHaveText("λάθος");
  await expect(page.locator("[data-done]")).toHaveText("2");
  await page.keyboard.press("Enter");

  await sheet.getByRole("button").first().click();
  await sheet.getByRole("button", { name: "Далее ›" }).click();
  await sheet.getByLabel("Ваш ответ").fill("λάθος");
  await page.keyboard.press("Enter");
  await sheet.getByRole("button", { name: "К итогу" }).click();

  const summary = page.locator("[data-summary]");
  await expect(summary).toBeVisible();
  await expect(summary.locator("[data-score]")).toHaveText(/из 4 верно/);
  await summary.getByRole("button", { name: "Пройти ещё раз" }).click();
  await expect(page.locator('[data-task="0"]')).toBeVisible();
  await expect(page.locator("[data-done]")).toHaveText("0");
  await expect(rows.first()).toHaveClass(/lp-empty/);

  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test("без JavaScript лендинг читается целиком: заголовок, полка и задания в HTML", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/web/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Греческий с нуля до экзамена A2");
  await expect(page.getByRole("list", { name: "Модули курса" }).locator("li")).not.toHaveCount(0);
  await expect(page.locator('[data-task="0"] .lp-prompt')).toBeVisible();
  await context.close();
});
