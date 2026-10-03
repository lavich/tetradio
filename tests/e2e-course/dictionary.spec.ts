import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await page.getByTestId("course-next").click();
  await expect(page.getByRole("article").first()).toBeVisible();
});

test("словарь: слова и фразы урока по группам, фильтр, лист слова ведёт в урок курса", async ({ page }) => {
  await page.goto("/words");
  const lesson = page.getByTestId("dictionary-lesson").first();
  await expect(lesson.getByRole("heading", { name: /1\.1.*Знакомство и είμαι/ })).toBeVisible();
  await expect(lesson.getByRole("link", { name: /είμαι/ })).toBeVisible();
  await expect(lesson.getByRole("link", { name: /Πώς σε λένε;/ })).toBeVisible(); // фраза — в словаре
  await expect(lesson.getByRole("img", { name: "не начато" }).first()).toBeVisible();
  await expect(page.getByTestId("word-count")).toHaveText("4 слова · 1 фраза");

  await page.getByRole("button", { name: /^закреплены/ }).click();
  await expect(page.getByTestId("dictionary-lesson")).toHaveCount(0);
  await page.getByRole("button", { name: /^все/ }).click();

  await page.getByRole("searchbox").fill("из");
  await expect(page.getByRole("region", { name: "Словарь" }).getByRole("link")).toHaveCount(1);
  await page.getByRole("link", { name: /από/ }).click();
  const sheet = page.getByTestId("entry-sheet");
  await expect(sheet).toContainText("из, от");
  await expect(sheet.getByRole("img", { name: "ещё не проверяли" }).first()).toBeVisible();
  await sheet.getByRole("link", { name: /Урок 1\.1/ }).click();
  await expect(page).toHaveURL(/\/course\/m01\/m01-1/);
});

test("широкое окно: словарь и открытое слово разворотом", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/words");
  await page.getByRole("link", { name: /Πώς σε λένε;/ }).click();
  await expect(page).toHaveURL(/\/words\/phrase\//);
  const row = page.getByRole("link", { name: /Πώς σε λένε;/ });
  await expect(row).toHaveAttribute("aria-current", "page");
  const list = (await page.getByRole("region", { name: "Словарь" }).boundingBox())!;
  const sheet = (await page.getByTestId("entry-sheet").boundingBox())!;
  expect(sheet.x).toBeGreaterThan(list.x + list.width);
  await expect(page.getByTestId("entry-sheet")).toContainText("Как тебя зовут?");
});
