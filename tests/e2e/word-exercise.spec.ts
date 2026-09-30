import { expect, test, type Page } from "@playwright/test";
import { installLessons } from "./helpers";
import { openTelegram, tg } from "./telegram";

/** След упражнения в базе: события и состояние карточки слова, метка синхронизации. */
const trace = (page: Page, databaseName: string) =>
  page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(store: string, run: (s: IDBObjectStore) => IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        const request = run(database.transaction(store).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const events = (await read("events", (s) => s.getAll())) as { ref: { id: string } }[];
    const states = (await read("cardStates", (s) => s.getAll())) as { ref: { id: string } }[];
    const dirty = await read("meta", (s) => s.get("sync:dirty"));
    database.close();
    return {
      events: events.filter((e) => e.ref.id === "w34-03").length,
      states: states.filter((e) => e.ref.id === "w34-03").length,
      dirty: JSON.stringify(dirty ?? null),
    };
  }, databaseName);

async function spell(page: Page, value: string) {
  await page.getByLabel("Твой ответ по-гречески").fill(value);
  await page.getByRole("button", { name: "Проверить" }).click();
}

test.describe("упражнение по выбору на странице слова", () => {
  test("написание: «Почти», «Ещё раз», верный ответ, возврат к слову — и ничего не записано", async ({ page }) => {
    await page.goto("/");
    await installLessons(page, ["lesson-3-4"]);
    await page.goto("/words/w34-03");
    const before = await trace(page, "lexi");
    await page.getByRole("button", { name: "Написание: пройти" }).click();
    await expect(page).toHaveURL(/\/words\/w34-03\/exercise\/spelling$/);
    await expect(page.getByText("Без учёта прогресса")).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await spell(page, "η κατσαρολα");
    await expect(page.getByTestId("feedback")).toContainText("Почти");
    await page.getByRole("button", { name: "Ещё раз" }).click();
    await spell(page, "η κατσαρόλα");
    await expect(page.getByTestId("feedback")).toContainText("Правильно");
    await page.getByRole("button", { name: "К слову" }).click();
    await expect(page).toHaveURL(/\/words\/w34-03$/);
    expect(await trace(page, "lexi")).toEqual({ ...before, events: 0, states: 0 });
  });

  test("в Telegram «Назад» ведёт на экран слова", async ({ page }) => {
    await openTelegram(page, { noCloud: true });
    await installLessons(page, ["lesson-3-4"]);
    await page.goto("/words/w34-03");
    const before = await trace(page, "lexi-tg-TaveloriBot-1001");
    await page.getByRole("button", { name: "Написание: пройти" }).click();
    await spell(page, "η κατσαρόλα");
    await expect(page.getByTestId("feedback")).toContainText("Правильно");
    await tg(page).back();
    await expect(page).toHaveURL(/\/words\/w34-03$/);
    expect(await trace(page, "lexi-tg-TaveloriBot-1001")).toEqual({ ...before, events: 0, states: 0 });
  });
});
