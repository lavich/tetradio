import { expect, test } from "@playwright/test";

test("вкладка «Прогресс»: навыки против порога, путь и темп, неделя, слова и «Настройки и данные»", async ({
  page,
}) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole("heading", { name: "Прогресс", level: 1 })).toBeVisible();
  for (const skill of ["reading", "listening", "writing", "speaking"])
    await expect(page.getByTestId(`skill-${skill}`).getByRole("img", { name: "нет данных" })).toBeVisible();
  await expect(page.getByText("Чтение и аудирование появятся после первой контрольной")).toBeVisible();
  await expect(page.getByRole("img", { name: /пройдено уроков: 0 из/ })).toBeVisible();
  await expect(page.getByTestId("pace")).toContainText("До K1 (Контрольная A1");
  await expect(page.getByTestId("pace")).not.toContainText("Ваш темп"); // меньше недели истории
  await expect(page.getByTestId("week")).toHaveText("На этой неделе занятий ещё не было.");
  await expect(page.getByTestId("cards-line")).toContainText("Карточки появятся после первого пройденного урока");
  await page.getByRole("link", { name: "Настройки и данные" }).click();
  await expect(page).toHaveURL(/\/progress\/settings$/);
  await expect(page.getByRole("heading", { name: "Копия", exact: true })).toBeVisible();
  // Служебные экраны остаются под вкладкой «Прогресс».
  await expect(page.getByRole("navigation").getByRole("link", { name: "Прогресс" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto("/app/more");
  await expect(page).toHaveURL(/\/progress$/);
  await page.goto("/app/more/backup");
  await expect(page).toHaveURL(/\/progress\/settings$/);
  await page.goto("/app/progress/stats");
  await expect(page).toHaveURL(/\/progress$/);
});
