import { expect, test } from "@playwright/test";
import { installLessons, ready } from "./helpers";

test("работает без сети после закрытия страницы для скачанного урока", async ({ context, page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-2"]);
  // «Скачать для офлайн» получает все обязательные медиа урока; готовность показывается только после проверки файлов.
  await page.goto("/lessons/lesson-1-2");
  await page.getByRole("button", { name: "Скачать для офлайн" }).click();
  await expect(page.getByTestId("lesson-offline")).toContainText("Медиа: 30 из 30");
  await page.goto("/");
  await ready(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
  await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
  await expect(page.getByText(/Готово офлайн|Офлайн-пакет/)).toBeVisible();
  // Подписанный курс доустанавливает все уроки, поэтому неустановленный урок для проверки готовим сами.
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("lexi");
      request.onsuccess = () => resolve(request.result);
    });
    const tx = database.transaction(["lessons", "packages", "lessonItems"], "readwrite");
    tx.objectStore("lessons").delete("lesson-1-3");
    tx.objectStore("packages").delete("lesson-1-3");
    const links = tx.objectStore("lessonItems").getAllKeys();
    links.onsuccess = () => {
      for (const key of links.result as [string, string][])
        if (key[0] === "lesson-1-3") tx.objectStore("lessonItems").delete(key);
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await page.close();

  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await offlinePage.goto("/");
  await expect(offlinePage.getByTestId("today-title")).toBeVisible();
  await offlinePage.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await offlinePage.getByRole("searchbox").fill("σπίτι");
  await offlinePage.getByRole("link", { name: /το σπίτι/ }).click();
  // Картинка читается из IndexedDB, а не из сети.
  await expect(offlinePage.getByTestId("word-art")).toBeVisible();
  await expect(offlinePage.getByText("Το σπίτι μας είναι μεγάλο.")).toBeVisible();
  await offlinePage.getByRole("button", { name: "Потренировать слово" }).click();
  await expect(offlinePage.getByText("Новое слово")).toBeVisible();
  // Неустановленный урок без сети: понятное состояние и повтор, а не пустой урок.
  await offlinePage.goto("/lessons/lesson-1-3");
  await expect(offlinePage.getByText("Пакет не загружен")).toBeVisible();
  await expect(offlinePage.getByRole("button", { name: "Повторить загрузку" })).toBeVisible();
  await expect(offlinePage.getByRole("heading", { name: /^Слова · \d+$/ })).toHaveCount(0);
  await context.setOffline(false);
});
