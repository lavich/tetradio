import { expect, test, type Page } from "@playwright/test";
import { installLessons } from "./helpers";

const PHRASE = {
  id: "p-gap",
  text: "Αυτή είναι η οικογένειά μου.",
  translation: "Это моя семья.",
  createdAt: "",
  updatedAt: "",
};

/** Занятие из одного задания: написание фразы целиком. */
async function seedSession(page: Page) {
  await page.evaluate(async (PHRASE) => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const tx = database.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put({
      id: "gap",
      createdAt: new Date().toISOString(),
      planDate: "2026-10-01",
      items: [
        {
          id: "current",
          ref: { kind: "phrase", id: PHRASE.id },
          unitKey: JSON.stringify(["phrase", PHRASE.id]),
          card: { kind: "phrase", phrase: PHRASE },
          type: "spelling",
          isNew: false,
          mode: "scheduled",
          expectedVersion: 0,
          options: [],
        },
      ],
      index: 0,
      status: "active",
      activeTimeMs: 0,
      introducedKeys: [],
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  }, PHRASE);
  await page.goto("/app/session");
  await page.getByTestId("prompt").waitFor();
}

test("ошибка в одном слове фразы: «неверно», затем попытка спрашивает это слово в пропуске", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-01T09:00:00"));
  await page.goto("/app/");
  await installLessons(page, ["mech-1"]);
  await seedSession(page);

  await page.getByRole("textbox").fill("Αυτή είναι η οικογένεια σου.");
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByTestId("feedback")).toContainText("Пока не получилось");
  await page.getByRole("button", { name: "Далее", exact: true }).click();

  await expect(page.getByText("Впиши пропущенное слово")).toBeVisible();
  await expect(page.getByRole("region", { name: "Задание" }).getByText("Это моя семья.")).toBeVisible();
  await expect(page.getByTestId("gap-phrase")).toHaveText("Αυτή είναι η οικογένειά ___.");
  await page.getByRole("textbox", { name: /Пропущенное слово/ }).fill("μου");
  await page.getByRole("button", { name: "Проверить" }).click();
  await expect(page.getByTestId("feedback")).toContainText("Правильно");
  await expect(page.getByTestId("gap-phrase")).toHaveText("Αυτή είναι η οικογένειά μου.");
});
