import { expect, test, type Page } from "@playwright/test";
import { installLessons, seedQueue } from "./helpers";
import { bridgeScript, launchHash, onlyReviews, openTelegram, tg } from "./telegram";

/**
 * Владелец данных и изоляция аккаунтов. `/web/` — та же сборка без мока Telegram, как на GitHub Pages
 * (собирается рядом в playwright.config.ts); `/` — сборка тестов с моком.
 */
const databases = (page: Page) =>
  page.evaluate(async () => (await indexedDB.databases()).map((info) => info.name ?? "").sort());
const A = 1001,
  B = 2002;
const dbOf = (id: number) => `tetradio-tg-tetradio_local-${id}`;
const count = (page: Page, databaseName: string, store: string) =>
  page.evaluate(
    async ([databaseName, store]) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
      });
      const request = database.transaction(store).objectStore(store).count();
      const result = await new Promise<number>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      return result;
    },
    [databaseName, store] as const,
  );

test.describe("production вне Telegram", () => {
  test("страница предлагает открыть бота, IndexedDB не создаётся, прежняя браузерная база не читается", async ({
    page,
  }) => {
    // Прежний браузерный профиль на этом устройстве: база `tetradio` со словом.
    await page.goto("/web/");
    await expect(page.getByTestId("open-in-telegram")).toBeVisible();
    expect(await databases(page)).toEqual([]);
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("tetradio", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("words", { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
      });
      const tx = database.transaction("words", "readwrite");
      tx.objectStore("words").put({ id: "legacy", greek: "το σπίτι", russian: "дом" });
      await new Promise((resolve) => (tx.oncomplete = resolve));
      database.close();
    });
    await page.reload();
    const gate = page.getByTestId("open-in-telegram");
    await expect(gate.getByRole("heading", { name: "Откройте в Telegram" })).toBeVisible();
    await expect(gate).toContainText("Найдите бота курса в Telegram"); // сборка тестов без VITE_TELEGRAM_BOT: ссылки нет
    await expect(page.getByText("το σπίτι")).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    expect(await databases(page)).toEqual(["tetradio"]);
    expect(await count(page, "tetradio", "words")).toBe(1);
  });
  test("Telegram без пользователя: ошибка запуска, база не открывается, облако не трогается", async ({ page }) => {
    await page.addInitScript(bridgeScript({}));
    await page.addInitScript(`window.Telegram.WebApp.initDataUnsafe={}`);
    const hash = `#tgWebAppData=${encodeURIComponent("auth_date=1&hash=e2e")}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`;
    for (const path of ["/web/", "/"]) {
      // Мок не подменяет Telegram-запуск без пользователя.
      await page.goto(`${path}${hash}`);
      await expect(page.getByTestId("launch-error")).toContainText("Telegram не передал сведения о пользователе");
      await expect(page.getByTestId("today-title")).toHaveCount(0);
      expect(await databases(page)).toEqual([]);
      expect((await tg(page).calls()).filter((call) => call.startsWith("cloud."))).toEqual([]);
      expect(await tg(page).calls()).toContain("ready");
    }
  });
});

test("смена аккаунта A → B на том же устройстве: B не видит прогресс A, синхронизация B идёт в его базу и облако", async ({
  page,
}) => {
  await openTelegram(page, { userId: A });
  await installLessons(page, ["mech-1"]);
  await onlyReviews(page);
  await seedQueue(page, [{ wordId: "w038", tested: ["recall"] }], dbOf(A));
  await page.getByRole("button", { name: /Начать занятие/ }).click();
  await page.waitForURL("**/session");
  await page.getByTestId("option").and(page.locator(":not([disabled])")).first().click();
  await expect(page.getByRole("button", { name: "Далее", exact: true })).toBeEnabled();
  await page.goto("/more");
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-phase", "synced", { timeout: 15000 });
  expect(await count(page, dbOf(A), "cardStates")).toBeGreaterThan(0);

  // Та же вкладка и то же хранилище (sessionStorage с контекстом A, базы A): Telegram открывает Mini App под B.
  await openTelegram(page, { userId: B });
  await page.goto("/words");
  await expect(page.getByTestId("word-count")).toHaveText("0 слов");
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Продолжить занятие/ })).toHaveCount(0);
  await page.goto("/more");
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-phase", /synced|idle/, { timeout: 15000 });
  // Перезагрузка без hash восстанавливает контекст вкладки — это B, а не A.
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("tetradio:launch")!).user.id)).toBe(B);
  const cloud = await tg(page).cloud();
  expect(Object.keys(cloud)).toEqual([]);
  expect(await databases(page)).toEqual([dbOf(A), dbOf(B)].sort());
  expect(await count(page, dbOf(B), "cardStates")).toBe(0);
  expect(await count(page, dbOf(B), "events")).toBe(0);
  expect(await count(page, dbOf(A), "cardStates")).toBeGreaterThan(0);

  // Контекст вкладки от B, а bridge сообщает A: запуск останавливается.
  await page.addInitScript(bridgeScript({ userId: A }));
  await page.goto("/");
  await expect(page.getByTestId("launch-error")).toContainText("не совпали с этим запуском");
  expect(await page.evaluate(() => sessionStorage.getItem("tetradio:launch"))).toBeNull();
  await page.goto(`/lessons${launchHash({ userId: A })}`); // другой путь: не переход по hash в том же документе
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.goto("/more");
  await expect(page.getByTestId("storage-scope")).toContainText("Telegram: облачная синхронизация");
  expect(await count(page, dbOf(A), "cardStates")).toBeGreaterThan(0);
});
