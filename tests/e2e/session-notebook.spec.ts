import { expect, test } from "../playwright-test";
import { type Page } from "@playwright/test";
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
const installedWord = (page: Page) =>
  page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const words: { id: string; greek: string; russian: string }[] = await new Promise((resolve) => {
      const request = database.transaction("words").objectStore("words").getAll();
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return words.find((entry) => entry.greek === "ο φίλος") ?? null;
  });

async function seedSession(page: Page, { done, phrase }: { done: number; phrase: boolean }) {
  // Слова урока пишутся после установки пакета асинхронно: ждём, пока нужное окажется в базе.
  await expect.poll(() => installedWord(page)).not.toBeNull();
  const word = (await installedWord(page))!;
  await page.evaluate(
    async ({ word, done, phrase, PHRASE, LONG }) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("tetradio-mock-1");
        request.onsuccess = () => resolve(request.result);
      });
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
    { word, done, phrase, PHRASE, LONG },
  );
  await page.goto("/app/session");
  await page.getByTestId("prompt").waitFor();
}

test.beforeEach(async ({ page }) => {
  // Дата на странице — по-гречески от сегодняшнего дня: фиксируем день, иначе проверка верна только в этот четверг.
  await page.clock.setFixedTime(new Date("2026-10-01T09:00:00"));
  await page.goto("/app/");
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
  await expect(page.getByRole("heading", { name: "Занятие завершено" })).toBeVisible();
  const finished = page.getByRole("region", { name: "С исправлением · 1" }).getByRole("listitem");
  await expect(finished).toHaveCount(3);
  await expect(finished.nth(2).getByRole("img", { name: "верно" })).toBeVisible();
});

test("короткие варианты — сеткой 2 × 2, длинные — строками 1)–4) на всю ширину с переносом", async ({ page }) => {
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
  expect(await options.first().evaluate((node) => getComputedStyle(node, "::before").content)).toBe(
    'counter(option) ")"',
  ); // номера 1) 2) 3) 4)
  expect((await options.first().boundingBox())!.height).toBeGreaterThan(40); // длинный вариант переносится
  await options.nth(2).click();
  await expect(page.locator('[data-answer="wrong"] span').first()).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByRole("status")).toHaveText("Верно: 2) Я хотел(а) бы открыть счёт.");
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
  await page.getByTestId("option").first().click();
  await expect(
    page.getByRole("group", { name: "Занятие" }).getByRole("button", { name: "Далее", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Задание" }).getByRole("button", { name: "Далее" })).toHaveCount(0);
});

test("телефон: главное действие — в облачке, под пальцем", async ({ page }) => {
  await seedSession(page, { done: 1, phrase: false });
  await page.getByTestId("option").first().click();
  await expect(
    page.getByRole("group", { name: "Занятие" }).getByRole("button", { name: "Далее", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Задание" }).getByRole("button", { name: "Далее" })).toHaveCount(0);
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

async function seedResult(page: Page, cards: number, extras: { states?: boolean; skipped?: boolean } = {}) {
  await page.evaluate(
    async ([cards, extras]) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("tetradio-mock-1");
        request.onsuccess = () => resolve(request.result);
      });
      let word: { id: string; greek: string; russian: string } | undefined;
      for (let attempt = 0; attempt < 100 && !word; attempt++) {
        const words: { id: string; greek: string; russian: string }[] = await new Promise((resolve) => {
          const request = database.transaction("words").objectStore("words").getAll();
          request.onsuccess = () => resolve(request.result);
        });
        word = words.find((entry) => entry.greek === "ο φίλος");
        if (!word) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!word) throw new Error("слово «ο φίλος» не установилось");
      const now = new Date().toISOString();
      const items: unknown[] = [];
      const events: unknown[] = [];
      const add = (card: number, attempt: number, verdict: "right" | "wrong" | "almost") => {
        const id = `c${card}-${attempt}`;
        const unitKey = JSON.stringify(["word", `${word.id}-${card}`]);
        items.push({
          id,
          ref: { kind: "word", id: `${word.id}-${card}` },
          unitKey,
          card: { kind: "word", word },
          type: "recognition",
          isNew: false,
          mode: attempt ? "practice" : "scheduled",
          expectedVersion: 0,
          options: [],
          eventId: `e-${id}`,
          ...(attempt ? { retryOf: `c${card}-0` } : {}),
        });
        events.push({
          id: `e-${id}`,
          sessionId: "result",
          itemId: id,
          ref: { kind: "word", id: `${word.id}-${card}` },
          unitKey,
          snapshot: { greek: word.greek, russian: word.russian },
          type: "recognition",
          mode: attempt ? "practice" : "scheduled",
          rating: verdict === "right" ? 3 : verdict === "almost" ? 2 : 1,
          correct: verdict === "right",
          answer: verdict === "right" ? word.russian : "молоко",
          createdAt: new Date(Date.parse(now) + items.length * 1000).toISOString(),
          localDate: now.slice(0, 10),
          responseTimeMs: 4000,
        });
      };
      for (let card = 0; card < cards; card++) {
        if (card === 2) add(card, 0, "wrong");
        else if (card === 4) add(card, 0, "almost");
        else if (card === 8) {
          add(card, 0, "wrong");
          add(card, 1, "right");
        } else add(card, 0, "right");
      }
      if (extras.skipped)
        items.push({
          id: "skipped",
          ref: { kind: "word", id: `${word.id}-skip` },
          unitKey: JSON.stringify(["word", `${word.id}-skip`]),
          card: { kind: "word", word },
          type: "recognition",
          isNew: false,
          mode: "scheduled",
          expectedVersion: 0,
          options: [],
          skipped: true,
        });
      const tx = database.transaction(["sessions", "events", "cardStates"], "readwrite");
      if (extras.states) {
        const hour = 3600000;
        const state = (card: number, due: number) => ({
          unitKey: JSON.stringify(["word", `${word.id}-${card}`]),
          ref: { kind: "word", id: `${word.id}-${card}` },
          introducedAt: now,
          version: 1,
          card: {
            due: new Date(Date.parse(now) + due),
            stability: 1,
            difficulty: 5,
            elapsed_days: 0,
            scheduled_days: 1,
            reps: 1,
            lapses: 1,
            state: 2,
          },
        });
        for (const [card, due] of [
          [2, 30 * hour],
          [4, -hour],
          [8, 30 * hour],
        ] as const)
          tx.objectStore("cardStates").put(state(card, due));
      }
      tx.objectStore("sessions").put({
        id: "result",
        createdAt: now,
        planDate: "2026-10-01",
        items,
        index: items.length,
        status: "done",
        activeTimeMs: 7 * 60000,
        introducedKeys: [],
      });
      for (const event of events) tx.objectStore("events").put(event);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    },
    [cards, extras] as const,
  );
  await page.goto("/app/session/result/result");
}

test("итог на телефоне: число, полоса и ошибки выше свёрнутого списка верных", async ({ page }) => {
  await seedResult(page, 20);
  await expect(page.getByRole("heading", { name: "Занятие завершено", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Занятие завершено" })).toHaveCount(1);
  await expect(page.getByTestId("result-count")).toHaveText("17 из 20 без ошибок");
  const cells = page.getByTestId("result-cells").locator("i");
  await expect(cells).toHaveCount(20);
  const heights = await cells.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(heights.filter((height) => height > 10)).toHaveLength(3);
  await expect(page.getByText(/^21 ответ · точность 86% · 7 минут$/)).toBeVisible();
  const recap = (await page.getByRole("region", { name: "Результат занятия" }).boundingBox())!;
  const cloud = (await page.getByRole("group", { name: "Итог занятия" }).boundingBox())!;
  expect(recap.y + recap.height).toBeLessThanOrEqual(cloud.y);
  const fixed = page.getByRole("region", { name: "С исправлением · 3" });
  await expect(fixed.getByRole("listitem")).toHaveCount(4);
  expect((await fixed.boundingBox())!.y).toBeGreaterThan(recap.y + recap.height);
  const fold = page.getByRole("button", { name: "Без ошибок — 17, показать" });
  await expect(page.getByRole("region", { name: "Без ошибок" }).getByRole("listitem")).toHaveCount(0);
  await fold.click();
  await expect(page.getByRole("region", { name: "Без ошибок" }).getByRole("listitem")).toHaveCount(17);
  await expect(page.getByRole("button", { name: "Без ошибок — 17, скрыть" })).toHaveAttribute("aria-expanded", "true");
});

test("итог от 900 px: лист справа, строка «Без ошибок» видна и раскрывается", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await seedResult(page, 20);
  const recap = (await page.getByRole("region", { name: "Результат занятия" }).boundingBox())!;
  const fixed = (await page.getByRole("region", { name: "С исправлением · 3" }).boundingBox())!;
  expect(recap.x).toBeGreaterThan(fixed.x + fixed.width);
  await page.getByRole("button", { name: "Без ошибок — 17, показать" }).click();
  await expect(page.getByRole("region", { name: "Без ошибок" }).getByRole("listitem")).toHaveCount(17);
});

test("итог занятия без ошибок: целая полоса, групп с ошибками нет", async ({ page }) => {
  await seedResult(page, 2);
  await expect(page.getByTestId("result-count")).toHaveText("2 из 2 без ошибок");
  await expect(page.getByRole("button", { name: "Без ошибок — 2, показать" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^С исправлением/ })).toHaveCount(0);
});

test("итог: ошибки, которые вернутся завтра, названы греческими словами, готовые — кнопкой повтора", async ({
  page,
}) => {
  await seedResult(page, 20, { states: true });
  const recap = page.getByRole("region", { name: "Результат занятия" });
  await expect(recap.getByText("Вернутся завтра")).toBeVisible();
  await expect(recap.locator("b[lang=el]")).toContainText("ο φίλος");
  await expect(recap.getByRole("button", { name: "Повторить ошибки (1)" })).toBeVisible();
});

test("итог: пропущенное задание — в своей группе и не меняет числа", async ({ page }) => {
  await seedResult(page, 20, { skipped: true });
  await expect(page.getByTestId("result-count")).toHaveText("17 из 20 без ошибок");
  await expect(page.getByRole("region", { name: "Пропущено · 1" }).getByRole("listitem")).toHaveCount(1);
});

test("итог без ответов: лист так и говорит, строки точности и повтора нет", async ({ page }) => {
  await seedResult(page, 0, { skipped: true });
  await expect(page.getByRole("region", { name: "Результат занятия" })).toContainText("Ответов нет");
  await expect(page.getByTestId("result-count")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Повторить ошибки/ })).toHaveCount(0);
});
