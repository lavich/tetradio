import { expect, test } from "@playwright/test";
import { completeLessons, installLessons, ready } from "./helpers";

test("первый запуск: «Учить курс» открывает «Сегодня» курса, карточки — после первого пройденного урока", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await expect(page.getByTestId("today-title")).toHaveText("Начните с курса");
  await expect(page.getByTestId("first-course")).toContainText("Механики");
  // Пока уроков нет, начинать нечего: кнопки занятия нет, а не пустая очередь после нажатия.
  await expect(page.getByRole("button", { name: "Повторить карточки" })).toHaveCount(0);
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("cards-later")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Повторить карточки" })).toHaveCount(0);
  await completeLessons(page, ["mech-1"]);
  await expect(page.getByTestId("cards-today")).toContainText(/новы[хе]|новая/);
  await expect(page.getByRole("button", { name: "Повторить карточки" })).toBeEnabled();
});

test("фокус с клавиатуры не прячется под нижней навигацией", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["mech-1"]);
  // Длинный словарь: строки уходят ниже навигации, и Tab доходит до них.
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await page.getByRole("heading", { name: "Словарь", level: 1 }).waitFor();
  const navTop = await page.getByRole("navigation").evaluate((nav) => nav.getBoundingClientRect().top);
  const focusedBottom = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return active && !active.closest("nav") && active !== document.body
        ? active.getBoundingClientRect().bottom
        : null;
    });
  let checked = 0;
  for (let step = 0; step < 40; step++) {
    await page.keyboard.press("Tab");
    if ((await focusedBottom()) === null) continue;
    checked++;
    // Докрутка к фокусу идёт на следующем кадре после перехода.
    await expect.poll(async () => (await focusedBottom()) ?? 0).toBeLessThanOrEqual(navTop);
  }
  expect(checked).toBeGreaterThan(10);
});
