import type { Page } from "@playwright/test";
import { expect, test } from "../playwright-test";
import { installLessons } from "./helpers";

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

test.beforeEach(async ({ page }) => {
  await installLessons(page, ["mech-1", "mech-2", "mech-3", "mech-4"]);
});

test("словарь: «Назад» со слова возвращает поиск и позицию списка, переход в другой раздел — сверху", async ({
  page,
}) => {
  // Низкое окно: «Прогресс» тоже прокручивается, иначе браузер прижал бы его к верху и без сброса.
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto("/app/words");
  const list = page.getByRole("region", { name: "Словарь" });
  await page.getByRole("searchbox").fill("φίλ");
  await expect(page).toHaveURL(/\/words\?q=/);
  await list.getByRole("link", { name: /ο φίλος/ }).click();
  await expect(page.getByTestId("entry-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("φίλ");
  await expect(list.getByRole("link", { name: /ο φίλος/ })).toBeVisible();

  await page.getByRole("searchbox").fill("");
  await expect(page).toHaveURL(/\/words$/);
  const rows = list.getByRole("link");
  await expect.poll(() => rows.count()).toBeGreaterThan(40);
  const target = rows.nth(40);
  await target.scrollIntoViewIfNeeded();
  const name = await target.getAttribute("href");
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(1000);
  await target.click();
  await expect(page.getByTestId("entry-sheet")).toBeVisible();
  expect(await scrollY(page)).toBe(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/words$/);
  await expect.poll(() => scrollY(page)).toBe(before);
  await expect(list.locator(`a[href="${name}"]`)).toBeInViewport();

  await page.getByRole("navigation", { name: "Основные разделы" }).getByRole("link", { name: "Прогресс" }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(list).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
    .toBeGreaterThan(100);
  expect(await scrollY(page)).toBe(0);
});
