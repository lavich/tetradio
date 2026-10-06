import { expect, test } from "@playwright/test";
import { completeLessons, installLessons, ready, seedQueue } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/");
  await ready(page);
  await installLessons(page, ["mech-1", "mech-2", "mech-3", "mech-4"]);
});

test("оболочка открывается, разделы доступны с клавиатуры", async ({ page }) => {
  await expect(page.getByTestId("today-title")).toBeAttached();
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await expect(page.getByRole("heading", { name: "Словарь", level: 1 })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Курс" }).click();
  await expect(page.getByRole("heading", { name: "Полка", level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(["A", "BUTTON", "INPUT", "SELECT"]).toContain(focused);
});

test("исходные уроки, карточка слова и ручная тренировка", async ({ page }) => {
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await page.getByRole("searchbox").fill("φίλος");
  await page.getByRole("link", { name: /ο φίλος/ }).click();
  await expect(page.getByText("/o ˈfilos/")).toBeVisible();
  await expect(page.getByText("Ударение на первый слог")).toBeVisible();
  await expect(page.getByText("Ο φίλος μας είναι παντρεμένος.")).toBeVisible();
  await expect(page.getByTestId("word-art")).toBeVisible();
  await page.getByRole("button", { name: "Потренировать слово" }).click();
  await expect(page.getByText("Новое слово")).toBeVisible();
});

test("занятие: знакомство, четыре упражнения, результат и продолжение после перезапуска", async ({ page }) => {
  await completeLessons(page, ["mech-2"]);
  await seedQueue(page, [
    { wordId: "w038", tested: ["recall"] },
    { wordId: "w032", tested: ["recall", "recognition"] },
    { wordId: "w019", tested: ["recall", "recognition", "assembly", "assembly"], audio: false },
    { wordId: "w057", tested: ["recall", "recognition", "assembly", "assembly", "spelling"], audio: true },
  ]);
  await page.getByRole("button", { name: "Повторить карточки" }).click();
  await page.waitForURL("**/session");
  const seen = new Set<string>();
  let completed = 0;
  for (let step = 0; step < 80; step++) {
    if (await page.getByRole("heading", { name: "Занятие завершено" }).isVisible()) break;
    const prompt = await page.getByTestId("prompt").first().innerText();
    const next = page.getByRole("button", { name: "Далее", exact: true });
    if (prompt === "Новое слово") {
      seen.add("intro");
    } else {
      await expect(page.getByTestId("grade")).toHaveCount(0);
      if (prompt === "Что значит это слово?" || prompt === "Что прозвучало?") {
        seen.add(prompt === "Что значит это слово?" ? "recognition" : "listening");
        await page.getByTestId("option").and(page.locator(":not([disabled])")).first().click();
      } else if (prompt === "Собери слово") {
        seen.add("assembly");
        for (const tile of await page.getByTestId("tile").all()) await tile.click();
        await page.getByRole("button", { name: "Проверить" }).click();
      } else if (prompt === "Напиши по-гречески") {
        seen.add("spelling");
        await page.getByLabel("Твой ответ по-гречески").fill("λάθος");
        await page.getByRole("button", { name: "Проверить" }).click();
        await expect(page.getByTestId("chars")).toBeVisible();
      } else throw new Error(`Неожиданное задание: ${prompt}`);
      await expect(page.getByTestId("feedback").or(page.locator('[data-answer="correct"]'))).toBeVisible();
      if (++completed === 3) {
        await page.goto("/app/");
        await ready(page);
        await page.getByRole("button", { name: "Продолжить повторение" }).click();
        await page.waitForURL("**/session");
        continue;
      }
    }
    const counter = page.getByLabel(/^(Знакомство|Упражнение) \d+ из \d+$/);
    const previous = await counter.getAttribute("aria-label");
    await next.click();
    await expect(page.getByLabel(previous!, { exact: true })).toHaveCount(0);
  }
  expect([...seen].sort()).toEqual(["assembly", "intro", "listening", "recognition", "spelling"]);
  await expect(page.getByRole("heading", { name: "Занятие завершено" })).toBeVisible();
  await expect(page.getByText(/Объективная точность/)).toBeVisible();
  await expect(page.getByText(/Активное время/)).toBeVisible();
  // Активное время копится по всем упражнениям и переживает возврат в занятие.
  const activeMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("tetradio-mock-1");
        request.onsuccess = () => {
          const rows = request.result.transaction("sessions", "readonly").objectStore("sessions").getAll();
          rows.onsuccess = () =>
            resolve(Math.max(0, ...rows.result.map((session: { activeTimeMs: number }) => session.activeTimeMs)));
        };
      }),
  );
  expect(activeMs).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Готово" }).click();
  await ready(page);
  // «Назад» после «Готово» не возвращает к итогу завершённого занятия.
  await page.goBack();
  await ready(page);
  await expect(page.getByRole("heading", { name: "Занятие завершено" })).toHaveCount(0);
  await page.reload();
  await ready(page);
  await page.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await expect(page.getByTestId("cards-line")).toContainText(/Учу [1-9]/);
  // Слова занятия в словаре уже «учу», а не «не начато».
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await page.getByRole("button", { name: /^учу/ }).click();
  await expect(page.getByTestId("dictionary-lesson").first()).toBeVisible();
});
