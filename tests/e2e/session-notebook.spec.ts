import { expect, test, type Page } from "@playwright/test";
import { installLessons } from "./helpers";

/** Фраза с длинными вариантами: такие не помещаются в половину листа. */
const PHRASE = {
  id: "p-notebook",
  text: "Θα ήθελα να ανοίξω λογαριασμό.",
  translation: "Я хотел(а) бы открыть счёт.",
  provenance: { sourceLabel: "тест", operation: "verbatim" },
  createdAt: "",
  updatedAt: "",
};
const LONG = [
  "Мне нужно заплатить по счёту за электричество.",
  "Я хотел(а) бы открыть счёт.",
  "Не могли бы вы прислать мне бланк?",
  "Я хотел(а) бы снять деньги со счёта.",
];

/**
 * Занятие на странице тетради: `done` уже отвеченных узнаваний слова «ο φίλος» (верно, кроме второго)
 * и текущее задание — узнавание слова с короткими вариантами или фразы с длинными.
 */
async function seedSession(page: Page, { done, phrase }: { done: number; phrase: boolean }) {
  await page.evaluate(
    async ({ done, phrase, PHRASE, LONG }) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("tetradio-mock-1");
        request.onsuccess = () => resolve(request.result);
      });
      const words: { id: string; greek: string; russian: string }[] = await new Promise((resolve) => {
        const request = database.transaction("words").objectStore("words").getAll();
        request.onsuccess = () => resolve(request.result);
      });
      const word = words.find((entry) => entry.greek === "ο φίλος")!;
      const now = new Date().toISOString();
      const ref = { kind: "word", id: word.id };
      const unitKey = JSON.stringify(["word", word.id]);
      const items: unknown[] = Array.from({ length: done }, (_, index) => ({
        id: `done-${index}`,
        ref,
        unitKey,
        card: { kind: "word", word },
        type: "recognition",
        isNew: false,
        mode: "scheduled",
        expectedVersion: 0,
        options: [],
        eventId: `e-done-${index}`,
      }));
      items.push(
        phrase
          ? {
              id: "current",
              ref: { kind: "phrase", id: PHRASE.id },
              unitKey: JSON.stringify(["phrase", PHRASE.id]),
              card: { kind: "phrase", phrase: PHRASE },
              type: "recognition",
              isNew: false,
              mode: "scheduled",
              expectedVersion: 0,
              options: LONG,
            }
          : {
              id: "current",
              ref,
              unitKey,
              card: { kind: "word", word },
              type: "recognition",
              isNew: false,
              mode: "scheduled",
              expectedVersion: 0,
              options: [word.russian, "молоко", "сыр", "вода"],
            },
      );
      const tx = database.transaction(["sessions", "events"], "readwrite");
      tx.objectStore("sessions").put({
        id: "notebook",
        createdAt: now,
        planDate: "2026-10-01",
        items,
        index: done,
        status: "active",
        activeTimeMs: 0,
        objectiveVersion: 1,
        introducedKeys: [],
      });
      for (let index = 0; index < done; index++)
        tx.objectStore("events").put({
          id: `e-done-${index}`,
          sessionId: "notebook",
          itemId: `done-${index}`,
          ref,
          unitKey,
          snapshot: { greek: word.greek, russian: word.russian },
          type: "recognition",
          mode: "scheduled",
          rating: index === 1 ? 1 : 3,
          correct: index !== 1,
          answer: index === 1 ? "молоко" : word.russian,
          createdAt: now,
          localDate: now.slice(0, 10),
          responseTimeMs: 4000,
        });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    },
    { done, phrase, PHRASE, LONG },
  );
  await page.goto("/session");
  await page.getByTestId("prompt").waitFor();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await installLessons(page, ["mech-1"]);
});

test("страница занятия: дата по-гречески, сделанное строками с галочкой и поправкой, лист с номером задания", async ({
  page,
}) => {
  await seedSession(page, { done: 2, phrase: false });
  await expect(page.getByRole("heading", { name: "Повторение", level: 1 })).toBeVisible();
  await expect(page.locator("header p[lang=el]")).toHaveText(/^Πέμπτη, 1 Οκτωβρίου$/);
  const rows = page.getByRole("region", { name: "Сделано" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("ο φίλος — друг");
  await expect(rows.nth(0).getByRole("img", { name: "верно" })).toBeVisible();
  // Ошибка: ответ зачёркнут красной ручкой, рядом правильный — без галочки.
  await expect(rows.nth(1).locator("s")).toContainText("молоко");
  await expect(rows.nth(1).getByRole("img")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Задание" })).toContainText("3. Что значит это слово?");
  // Ответ на текущее задание становится строкой сделанного после «Далее».
  await page.getByTestId("option").first().click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2).getByRole("img", { name: "верно" })).toBeVisible();
});

test("короткие варианты — сеткой 2 × 2, длинные — строками α–δ на всю ширину с переносом", async ({ page }) => {
  await seedSession(page, { done: 0, phrase: false });
  const options = page.getByTestId("option");
  const [a, b, c] = await Promise.all([0, 1, 2].map((index) => options.nth(index).boundingBox()));
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2); // два в ряд
  expect(c!.y).toBeGreaterThan(a!.y + a!.height - 1);
  await seedSession(page, { done: 0, phrase: true });
  const sheet = (await page.getByRole("region", { name: "Задание" }).boundingBox())!;
  for (let index = 0; index < 4; index++) {
    const box = (await options.nth(index).boundingBox())!;
    expect(box.width).toBeGreaterThan(sheet.width - 40); // строка на всю ширину листа
  }
  expect(await options.first().evaluate((node) => getComputedStyle(node, "::before").content)).toContain("lower-greek"); // буквы α β γ δ
  expect((await options.first().boundingBox())!.height).toBeGreaterThan(40); // длинный вариант переносится
  await options.nth(2).click();
  await expect(page.locator('[data-answer="wrong"] span').first()).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByRole("status")).toHaveText("Верно: β) Я хотел(а) бы открыть счёт.");
});

test("от 900 px: слева страница со списком, справа лист; облачко под правой колонкой", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await seedSession(page, { done: 3, phrase: true });
  const list = (await page.getByRole("region", { name: "Сделано" }).boundingBox())!;
  const sheet = (await page.getByRole("region", { name: "Задание" }).boundingBox())!;
  const cloud = (await page.getByRole("group", { name: "Занятие" }).boundingBox())!;
  expect(sheet.x).toBeGreaterThan(list.x + list.width);
  expect(Math.abs(sheet.y - list.y)).toBeLessThan(80);
  expect(cloud.x).toBeGreaterThan(sheet.x);
  expect(Math.abs(cloud.x + cloud.width - (sheet.x + sheet.width))).toBeLessThan(2);
  await expect(page.getByRole("button", { name: /^Сделано \d+/ })).toHaveCount(0); // на широком не сворачивается
});

test("телефон: длинный лист сворачивает сделанное в «Сделано N — показать», лист виден без прокрутки", async ({
  page,
}) => {
  await seedSession(page, { done: 8, phrase: true });
  const fold = page.getByRole("button", { name: "Сделано 8 — показать" });
  await expect(fold).toBeVisible();
  await expect(page.getByRole("region", { name: "Сделано" }).getByRole("listitem")).toHaveCount(0);
  const sheet = (await page.getByRole("region", { name: "Задание" }).boundingBox())!;
  const cloud = (await page.getByRole("group", { name: "Занятие" }).boundingBox())!;
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(cloud.y);
  await fold.click();
  await expect(page.getByRole("region", { name: "Сделано" }).getByRole("listitem")).toHaveCount(8);
  await page.getByRole("button", { name: "Сделано 8 — скрыть" }).click();
  await expect(page.getByRole("region", { name: "Сделано" }).getByRole("listitem")).toHaveCount(0);
});
