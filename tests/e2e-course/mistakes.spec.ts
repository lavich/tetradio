import { expect, test } from "../playwright-test";
import { type Page } from "@playwright/test";

const MISTAKE = JSON.stringify(["mistake", "m01-1/forms/q2"]);

/** Греческого голоса нет, записи реплик не скачиваются: проверки не зависят от звука машины. */
async function quiet(page: Page) {
  await page.addInitScript(() => {
    const synth = {
      getVoices: () => [],
      speak() {},
      cancel() {},
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  });
  await page.route("**/content/media/line-*", (route) => route.abort());
}
/** Строки базы приложения: карточки и события, без интерфейса. */
const rows = (page: Page, store: "cardStates" | "events") =>
  page.evaluate(async (store) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const all = await new Promise<{ unitKey: string; card?: { due: Date } }[]>((resolve) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return all.map((row) => ({ unitKey: row.unitKey, due: row.card ? new Date(row.card.due).getTime() : 0 }));
  }, store);
/** Срок карточки ошибки — в прошлом: она приходит в ближайшее занятие без ожидания первого шага. */
const makeDue = (page: Page) =>
  page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("cardStates", "readwrite");
    const store = tx.objectStore("cardStates");
    const request = store.get(key);
    request.onsuccess = () =>
      store.put({ ...request.result, card: { ...request.result.card, due: new Date(Date.now() - 60_000) } });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, MISTAKE);

async function turnTo(page: Page, name: string) {
  const target = page.getByRole("region", { name });
  const sheet = page.getByRole("article").first();
  const forward = page
    .getByRole("navigation", { name: "Страницы урока" })
    .getByRole("button", { name: /Далее|К итогу/ });
  await expect(sheet).toHaveAttribute("aria-label", /^Страница/);
  for (let turns = 0; turns < 20 && !(await target.count()); turns++) {
    const before = await sheet.getAttribute("aria-label");
    await forward.click();
    await expect(sheet).not.toHaveAttribute("aria-label", before!);
  }
  await expect(target).toBeVisible();
  return target;
}

test("ошибка в задании урока возвращается в повторение тем же пунктом", async ({ page }) => {
  await quiet(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await page.getByTestId("course-next").click();

  const forms = await turnTo(page, "Формы είμαι");
  await forms.getByRole("group", { name: "Варианты 1" }).getByRole("button", { name: "είμαι" }).click();
  await forms.getByRole("group", { name: "Варианты 2" }).getByRole("button", { name: "είναι" }).click();
  await forms.getByRole("button", { name: "Проверить" }).click();
  await expect(forms.getByRole("status")).toHaveText("1 из 2");

  // Карточка рождается со сроком через минуты и без события ответа: урок — не повторение.
  await expect.poll(async () => (await rows(page, "cardStates")).map((row) => row.unitKey)).toContain(MISTAKE);
  const [state] = (await rows(page, "cardStates")).filter((row) => row.unitKey === MISTAKE);
  expect(state.due - Date.now()).toBeLessThan(15 * 60_000);
  expect(await rows(page, "events")).toEqual([]);

  await page.goto("/app/");
  await expect(page.getByRole("img", { name: "повторение сделано" })).toHaveCount(0);

  await makeDue(page);
  await page.reload();
  await page.getByRole("button", { name: "Повторить карточки" }).click();
  await page.waitForURL("**/session");
  // Занятие перемешано с новыми словами урока: листаем до пункта задания.
  const task = page.getByText("Εσύ ___ από την Κύπρο;");
  const unknown = page.getByRole("button", { name: "Не знаю" });
  const next = page.getByRole("button", { name: "Далее" });
  for (let step = 0; step < 40; step++) {
    await expect(task.or(unknown).or(next).first()).toBeVisible();
    if (await task.isVisible()) break;
    if (await unknown.isVisible()) {
      await unknown.click();
      await expect(next).toBeVisible();
    }
    await next.click();
  }
  await expect(task).toBeVisible();
  await expect(page.getByText("Выберите форму глагола.")).toBeVisible();
  await page.getByTestId("option").filter({ hasText: "είσαι" }).click();
  await expect(page.getByRole("status")).toHaveText("Верно.");
  await expect(page.getByText("Εσύ — ты: είσαι.")).toBeVisible();
  // Верный ответ отодвигает срок карточки.
  await expect
    .poll(async () => (await rows(page, "cardStates")).find((row) => row.unitKey === MISTAKE)!.due)
    .toBeGreaterThan(Date.now());
});
