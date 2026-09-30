import { expect, test } from "@playwright/test";

/** Сколько записей в хранилищах браузерной базы: просмотр по ссылке не должен ничего в неё положить. */
const stored = (page: import("@playwright/test").Page) =>
  page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("lexi");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = (name: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = database.transaction(name).objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const [lessons, words, lessonItems, packages, media, assets, courses] = await Promise.all(
      ["lessons", "words", "lessonItems", "packages", "media", "assets", "courses"].map(all),
    );
    database.close();
    return {
      lessons: lessons.length,
      words: words.length,
      lessonItems: lessonItems.length,
      packages: packages.length,
      media: media.length,
      assets: assets.length,
      // Локальный курс «Мои слова» подписан у любого профиля; считаются только курсы каталога.
      subscribed: (courses as { subscribed: boolean; origin: string }[]).filter(
        (course) => course.origin === "content" && course.subscribed,
      ).length,
    };
  });

test.describe("ссылка на слово", () => {
  test("на чистой базе показывает карточку из пакета и ничего не сохраняет", async ({ page }) => {
    await page.goto("/share/word/w34-03");
    await expect(page.getByText("η κατσαρόλα", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("кастрюля", { exact: true })).toBeVisible();
    await expect(page.getByTestId("word-art")).toBeVisible();
    await expect(page.getByTestId("shared-lesson")).toHaveText(/^Слово из урока 3\.4/);
    await expect(page.locator("main a[href*='/lessons']")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Потренировать слово" })).toHaveCount(0);
    await page.getByTestId("shared-lesson").click();
    await expect(page).toHaveURL(/\/share\/word\/w34-03$/);
    expect(await stored(page)).toEqual({
      lessons: 0,
      words: 0,
      lessonItems: 0,
      packages: 0,
      media: 0,
      assets: 0,
      subscribed: 0,
    });
  });
  test("неизвестное слово — «Слово не найдено»", async ({ page }) => {
    await page.goto("/share/word/w99-99");
    await expect(page.getByText("Слово не найдено")).toBeVisible();
  });
});
