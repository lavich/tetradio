import { expect, test } from "@playwright/test";
import { openTelegram } from "../e2e/telegram";

test("копия: изменение облака на другом устройстве после предпросмотра требует нового предпросмотра", async ({
  page,
}) => {
  await openTelegram(page);
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await page.getByRole("link", { name: "Настройки и данные" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Сохранить полную копию" }).click(),
  ]);
  const path = (await download.path())!;
  await page.locator("#backup").setInputFiles(path);
  await expect(page.getByText(/Файл проверен/)).toBeVisible();

  // Другое устройство того же аккаунта публикует версию, пока открыт предпросмотр.
  await page.evaluate(() => {
    const pointer = { id: "other-1", device: "other", clock: { other: 1 }, createdAt: new Date().toISOString() };
    (window as unknown as { __tg: { cloud: Map<string, string> } }).__tg.cloud.set(
      "p_other",
      JSON.stringify({ ...pointer, format: 3, parts: 1, checksum: "00000000", resolves: [] }),
    );
  });
  await page.getByRole("button", { name: "Заменить данные копией" }).click();
  await page.getByRole("button", { name: "Заменить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Данные аккаунта изменились на другом устройстве — откройте предпросмотр заново.",
  );
  await expect(page.getByText("Данные восстановлены полностью.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Заменить данные копией" })).toHaveCount(0);

  await page.getByRole("button", { name: "Открыть предпросмотр заново" }).click();
  await expect(page.getByText(/Файл проверен/)).toBeVisible();
  await page.getByRole("button", { name: "Заменить данные копией" }).click();
  await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Заменить", exact: true }).click(),
  ]);
  await expect(page.getByText("Данные восстановлены полностью.")).toBeVisible();
});
