import { expect, test } from "@playwright/test";
import { installLessons, ready } from "./helpers";

/** Разметка слов примера: пример слова урока 1.4, ссылка ведёт на «το πάτωμα» из урока 1.3. Случай «карточки нет» — в компонентном тесте. */
test("слово примера показывает перевод и открывает установленную карточку", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-3", "lesson-1-4"]);
  await page.goto("/words/w41-03");
  const example = page.getByText("В контексте").locator("..");
  const line = page.getByTestId("example-gloss");
  await expect(line).toBeEmpty();
  await example.getByRole("button", { name: "καθαρό", exact: true }).click();
  // Ссылка на ту же карточку, в которой показан пример, действия не даёт.
  await expect(line).toHaveText("καθαρό — чистый");
  await example.getByRole("button", { name: "πάτωμα", exact: true }).click();
  await expect(line).toHaveText("πάτωμα — пол Открыть карточку");
  // Кнопки в тексте не раздвигают карточку шире экрана телефона.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await line.getByRole("link", { name: "Открыть карточку" }).click();
  await expect(page).toHaveURL(/\/words\/w24-08$/);
  await expect(page.getByText("το πάτωμα", { exact: true }).first()).toBeVisible();
});
