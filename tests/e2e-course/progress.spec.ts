import { expect, test } from "@playwright/test";

test("вкладка «Прогресс»: навыки против порога, путь по курсу, неделя и служебные экраны", async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole("heading", { name: "Прогресс", level: 1 })).toBeVisible();
  for (const skill of ["reading", "listening", "writing", "speaking"])
    await expect(page.getByTestId(`skill-${skill}`).getByRole("img", { name: "нет данных" })).toBeVisible();
  await expect(page.getByTestId("skill-writing")).toContainText("появится после первого задания");
  await expect(page.getByRole("img", { name: /пройдено уроков: 0 из/ })).toBeVisible();
  await expect(page.getByTestId("pace")).toContainText("К K1");
  await expect(page.getByRole("heading", { name: "Эта неделя" })).toBeVisible();
  // Клетки недели — пункты списка с подписью для диктора.
  const week = page.getByRole("list", { name: "Дни недели" });
  await expect(week.getByRole("listitem")).toHaveCount(7);
  expect(await week.ariaSnapshot()).toContain("listitem: Пн");
  await page.getByRole("link", { name: "Настройки" }).click();
  await expect(page).toHaveURL(/\/progress\/settings$/);
  // Служебные экраны остаются под вкладкой «Прогресс».
  await expect(page.getByRole("navigation").getByRole("link", { name: "Прогресс" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto("/app/more");
  await expect(page).toHaveURL(/\/progress$/);
  await page.goto("/app/more/backup");
  await expect(page).toHaveURL(/\/progress\/backup$/);
});
