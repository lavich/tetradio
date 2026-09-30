import { expect, test } from "@playwright/test";
import { installLessons, ready, setCourseLimit, useSchedule } from "./helpers";

test("первый запуск: «Учить курс» на «Сегодня» сразу даёт карточки на сегодня", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await expect(page.getByTestId("today-title")).toHaveText("Начните с курса");
  await expect(page.getByTestId("first-course")).toContainText("Греческий A2");
  // Пока уроков нет, начинать нечего: кнопки занятия нет, а не пустая очередь после нажатия.
  await expect(page.getByRole("button", { name: /Начать занятие/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("today-title")).toHaveText(/новы[хе]|новая/, { timeout: 30000 });
  await expect(page.getByRole("button", { name: /Начать занятие/ })).toBeEnabled();
  // Расписания ещё нет: панель ведёт туда, где его задают.
  await page.getByRole("link", { name: /Занятие не назначено/ }).click();
  await expect(page.getByRole("heading", { name: "Уроки", level: 1 })).toBeVisible();
});

test("пустая очередь: «На сегодня всё» и тренировка урока вместо «Начать занятие»", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-1"]);
  await setCourseLimit(page, "leeke", 0);
  await page.reload();
  await ready(page);
  await expect(page.getByTestId("today-title")).toHaveText("На сегодня всё");
  await expect(page.getByTestId("day-done")).toContainText("План на сегодня выполнен");
  await expect(page.getByRole("button", { name: /Начать занятие/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Потренировать урок 1.1" }).click();
  await page.waitForURL("**/session");
  await expect(page.getByTestId("prompt").first()).toBeVisible();
});

test("нехватка предела: решение под кнопкой занятия, предел поднимается на месте", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-1"]);
  await setCourseLimit(page, "leeke", 1);
  await useSchedule(page, "leeke", "lexi", 2);
  const shortfall = page.getByTestId("shortfall");
  await expect(shortfall).toContainText(/Чтобы успеть к сроку, нужно \d+ карточ/);
  await expect(shortfall).toContainText("Дневной предел курса «Греческий A2» — 1.");
  // Кнопка занятия стоит выше справки: план сначала, объяснения потом.
  const cta = await page.getByRole("button", { name: /Начать занятие/ }).boundingBox();
  expect(cta!.y).toBeLessThan((await shortfall.boundingBox())!.y);
  await expect(shortfall.getByRole("link", { name: "Перенести дату урока 1.1" })).toBeVisible();
  await shortfall.getByRole("button", { name: /^Поднять предел до \d+$/ }).click();
  await expect(shortfall).toHaveCount(0);
  await expect(page.getByTestId("today-title")).not.toHaveText("1 новая карточка");
});

test("фокус с клавиатуры не прячется под нижней навигацией", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-1"]);
  // Длинный список «Уроков»: строки каталога уходят ниже навигации, и Tab доходит до них.
  await page.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();
  await page.getByRole("heading", { name: "Уроки", level: 1 }).waitFor();
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
