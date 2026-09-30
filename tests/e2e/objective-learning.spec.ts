import { expect, test, type Page } from "@playwright/test";
import { GREEK_VOICE, installLessons, ready, setSettings } from "./helpers";

async function installSession(page: Page, type: string, isNew = false, count = 1) {
  await page.evaluate(
    async ({ type, isNew, count }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("lexi");
        r.onsuccess = () => resolve(r.result);
      });
      const tx = db.transaction(["words", "sessions"], "readwrite");
      const request = tx.objectStore("words").getAll();
      request.onsuccess = () => {
        const pool = request.result;
        const selected = count === 1 ? [pool.find((word) => word.id === "w12-16")] : pool.slice(0, count);
        const items = selected.map((word, index) => ({
          id: `objective-${index}`,
          ref: { kind: "word", id: word.id },
          unitKey: JSON.stringify(["word", word.id]),
          card: { kind: "word", word },
          type,
          isNew,
          mode: "scheduled",
          expectedVersion: 0,
          options:
            type === "assembly"
              ? ["τι", "το", "σπί"]
              : type === "recognition" || type === "comprehension"
                ? [word.russian, "другой ответ", "ещё ответ", "неверно"]
                : type === "listening"
                  ? [word.greek, "ναι", "όχι", "ευχαριστώ"]
                  : [],
        }));
        tx.objectStore("sessions").put({
          id: "objective",
          createdAt: new Date().toISOString(),
          planDate: "2026-09-16",
          items,
          index: 0,
          status: "active",
          activeTimeMs: 0,
          objectiveVersion: type === "recall" ? undefined : 1,
          introducedKeys: [],
        });
      };
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { type, isNew, count },
  );
  await page.goto("/session");
  await page.getByTestId("prompt").first().waitFor();
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("lexi");
      r.onsuccess = () => resolve(r.result);
    });
    const read = (name: string) =>
      new Promise<any[]>((resolve) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const [events, states, sessions] = await Promise.all([read("events"), read("cardStates"), read("sessions")]);
    db.close();
    return { events, states, session: sessions.find((s) => s.id === "objective") };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-2"]);
});

for (const type of ["recognition", "assembly", "spelling", "listening"]) {
  test(`${type}: «Не знаю» показывает ответ, сохраняет ошибку и одну тренировку`, async ({ page }) => {
    await installSession(page, type);
    await expect(page.getByTestId("grade")).toHaveCount(0);
    await expect(page.getByText("Насколько легко вспомнилось?")).toHaveCount(0);
    await page.getByRole("button", { name: "Не знаю", exact: true }).click();
    await expect(page.getByTestId("feedback").or(page.locator('[data-answer="correct"]'))).toBeVisible();
    const first = await stored(page);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({ correct: false, rating: 1, answer: "", type });
    expect(first.session.items).toHaveLength(2);
    expect(first.session.status).toBe("active");
    // Перезагрузка сразу после ответа продолжает дополнительную попытку.
    await page.reload();
    await page.getByRole("button", { name: "Не знаю", exact: true }).click();
    await expect(page.getByTestId("feedback").or(page.locator('[data-answer="correct"]'))).toBeVisible();
    const second = await stored(page);
    expect(second.events).toHaveLength(2);
    expect(second.events.some((e) => e.mode === "practice")).toBe(true);
    expect(second.states).toEqual(first.states);
    expect(second.session.items).toHaveLength(2);
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Занятие завершено" })).toBeVisible();
  });
}

test("аудирование: после ответа раскрывается значение слова", async ({ page }) => {
  await installSession(page, "listening");
  await expect(page.getByTestId("reveal")).toHaveCount(0);
  await page.getByTestId("option").filter({ hasText: "ναι" }).click();
  const reveal = page.getByTestId("reveal");
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText("дом");
  await expect(reveal).toContainText("ˈspiti");
  await expect(reveal).toContainText("Наш дом большой.");
  // Показ ничего не сохраняет: событие ровно одно, от самого ответа.
  expect((await stored(page)).events).toHaveLength(1);
});

test("ошибка в написании: дополнительная попытка идёт сборкой, а не повторным набором", async ({ page }) => {
  await installSession(page, "spelling");
  await page.getByRole("button", { name: "Не знаю", exact: true }).click();
  await expect(page.getByTestId("feedback").or(page.locator('[data-answer="correct"]'))).toBeVisible();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByTestId("tile").first()).toBeVisible();
  await expect(page.getByLabel("Твой ответ по-гречески")).toHaveCount(0);
  const after = await stored(page);
  expect(after.session.items[1]).toMatchObject({ type: "assembly", mode: "practice", retryOf: "objective-0" });
});

test("понимание на слух: звучит само, письменной опоры нет до ответа", async ({ page }) => {
  await page.addInitScript(GREEK_VOICE);
  await installSession(page, "comprehension");
  await expect(page.getByTestId("prompt")).toHaveText("Что это значит?");
  // Звучит само, а написания до ответа нет: иначе проверялось бы чтение.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken))
    .toContain("το σπίτι");
  await expect(page.getByTestId("reveal")).toHaveCount(0);
  await expect(page.getByTestId("option").first()).toBeVisible();
  await page.getByRole("button", { name: "Повторить аудио" }).click();
  await page.getByTestId("option").first().click();
  // После ответа видно, что именно прозвучало.
  await expect(page.getByTestId("reveal")).toContainText("το σπίτι");
  const after = await stored(page);
  expect(after.events[0]).toMatchObject({ type: "comprehension" });
});

test("знакомство озвучивается само, а с выключенной настройкой молчит", async ({ page }) => {
  await page.addInitScript(GREEK_VOICE);
  await installSession(page, "recognition", true);
  await expect(page.getByTestId("prompt")).toHaveText("Новое слово");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken))
    .toContain("το σπίτι");
  // Узнавание звучит тем же порядком: на экране показано греческое слово, ответ — перевод.
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByTestId("prompt")).toHaveText("Что значит это слово?");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)).toBe(2);
  // Выключенная настройка убирает автозапуск, но не кнопку.
  await setSettings(page, { autoSpeak: false });
  await installSession(page, "recognition", true);
  await expect(page.getByTestId("prompt")).toHaveText("Новое слово");
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toEqual([]);
  await page.getByRole("button", { name: "Послушать слово" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken))
    .toContain("το σπίτι");
});

test("знакомство идёт отдельным проходом и переживает перезагрузку без ответа", async ({ page }) => {
  await installSession(page, "recognition", true, 3);
  await expect(page.getByTestId("prompt")).toHaveText("Новое слово");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByLabel("Знакомство 2 из 3")).toBeVisible();
  const first = await stored(page);
  expect(first.events).toEqual([]);
  expect(first.states).toEqual([]);
  expect(first.session.introducedKeys).toHaveLength(1);
  await page.reload();
  await expect(page.getByLabel("Знакомство 2 из 3")).toBeVisible();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByLabel("Знакомство 3 из 3")).toBeVisible();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByTestId("prompt")).toHaveText("Что значит это слово?");
  const after = await stored(page);
  expect(after.events).toEqual([]);
  expect(after.session.introducedKeys).toHaveLength(3);
  await page.getByTestId("option").first().click();
  await expect(page.locator('[data-answer="correct"]')).toContainText("Правильный ответ");
  await expect(page.getByTestId("feedback")).toHaveCount(0);
  const event = (await stored(page)).events[0];
  // Оценка зависит от времени ответа, а тест проверяет не её: верный ответ не должен быть Again.
  expect(event).toMatchObject({ correct: true });
  expect(event.rating).toBeGreaterThan(1);
});

test("старое вспоминание заменяется объективным заданием при продолжении", async ({ page }) => {
  await installSession(page, "recall");
  await expect(page.getByTestId("prompt")).toHaveText("Что значит это слово?");
  await expect(page.getByRole("button", { name: "Показать ответ" })).toHaveCount(0);
  await expect(page.getByTestId("grade")).toHaveCount(0);
  await page.getByRole("button", { name: "Не знаю", exact: true }).click();
  await expect(page.getByTestId("feedback").or(page.locator('[data-answer="correct"]'))).toBeVisible();
  expect((await stored(page)).events[0]).toMatchObject({ type: "recognition", correct: false });
});

test("неверный выбор отмечается крестиком, правильный — галочкой, без отдельной карточки", async ({ page }) => {
  await installSession(page, "recognition");
  await page.getByTestId("option").nth(1).click();
  const right = page.locator('[data-answer="correct"]');
  const wrong = page.locator('[data-answer="wrong"]');
  await expect(right).toContainText("Правильный ответ");
  await expect(wrong).toContainText("Неправильный ответ");
  await expect(right.locator("svg")).toHaveCount(1);
  await expect(wrong.locator("svg")).toHaveCount(1);
  await expect(right).toHaveCSS("background-color", "rgb(236, 253, 243)");
  await expect(wrong).toHaveCSS("background-color", "rgb(254, 242, 242)");
  await expect(right).toHaveCSS("opacity", "1");
  await expect(wrong).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("feedback")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Далее", exact: true })).toBeVisible();
});
