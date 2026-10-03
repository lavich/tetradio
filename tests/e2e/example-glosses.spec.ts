import { expect, test } from "@playwright/test";
import { installLessons, ready } from "./helpers";

/** Разметка слов примера: пример слова урока 1.4, ссылка ведёт на «ο άντρας» из урока 1.3. Случай «карточки нет» — в компонентном тесте. */
test("слово примера показывает перевод и открывает установленную карточку", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["mech-3", "mech-4"]);
  await page.goto("/words/w096");
  const example = page.getByTestId("entry-sheet");
  const line = page.getByTestId("example-gloss");
  await expect(line).toBeEmpty();
  await example.getByRole("button", { name: "γιατρός", exact: true }).click();
  // Ссылка на ту же карточку, в которой показан пример, действия не даёт.
  await expect(line).toHaveText("γιατρός — врач");
  await example.getByRole("button", { name: "άντρας", exact: true }).click();
  await expect(line).toHaveText("άντρας — муж Открыть карточку");
  // Кнопки в тексте не раздвигают карточку шире экрана телефона.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await line.getByRole("link", { name: "Открыть карточку" }).click();
  await expect(page).toHaveURL(/\/words\/w091$/);
  await expect(page.getByText("ο άντρας", { exact: true }).first()).toBeVisible();
});
