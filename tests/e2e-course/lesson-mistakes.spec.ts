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
/** Состояние ошибки от прежней версии со сроком в прошлом: раньше оно приходило в ближайшее занятие. */
const seedDue = (page: Page) =>
  page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("cardStates", "readwrite");
    tx.objectStore("cardStates").put({
      unitKey: key,
      ref: { kind: "mistake", id: "m01-1/forms/q2" },
      introducedAt: new Date().toISOString(),
      version: 1,
      card: {
        due: new Date(Date.now() - 60_000),
        stability: 1,
        difficulty: 5,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 1,
        lapses: 1,
        state: 1,
      },
    });
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

test("ошибка в задании урока не создаёт карточку, а накопленная ошибка не приходит в повторение", async ({ page }) => {
  await quiet(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await page.getByTestId("course-next").click();

  const forms = await turnTo(page, "Формы είμαι");
  await forms.getByRole("group", { name: "Варианты 1" }).getByRole("button", { name: "είμαι" }).click();
  await forms.getByRole("group", { name: "Варианты 2" }).getByRole("button", { name: "είναι" }).click();
  await forms.getByRole("button", { name: "Проверить" }).click();
  await expect(forms.getByRole("status")).toHaveText("1 из 2");

  expect((await rows(page, "cardStates")).map((row) => row.unitKey)).not.toContain(MISTAKE);
  expect(await rows(page, "events")).toEqual([]);

  await seedDue(page);
  await page.goto("/app/");
  await expect(page.getByTestId("cards-today")).toBeVisible();
  await expect(page.getByTestId("cards-today")).not.toContainText("повторен");
  await page.getByRole("button", { name: "Повторить карточки" }).click();
  await page.waitForURL("**/session");
  const kinds = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const sessions = await new Promise<{ items: { ref: { kind: string } }[] }[]>((resolve) => {
      const request = db.transaction("sessions").objectStore("sessions").getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return [...new Set(sessions.flatMap((session) => session.items.map((item) => item.ref.kind)))];
  });
  expect(kinds).not.toContain("mistake");
  expect(kinds.length).toBeGreaterThan(0);
});
