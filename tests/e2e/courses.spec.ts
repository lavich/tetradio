import { expect, test, type Page } from "@playwright/test";
import { ready } from "./helpers";

/**
 * Каталог без последнего урока курса: так выглядит поставка до того, как урок опубликован.
 * Состав уроков читается из самой поставки: новый урок в каталоге не должен править этот сценарий.
 */
async function withoutLastLesson(page: Page) {
  const published: string[] = [];
  let dropped = "";
  await page.route("**/content/catalog.json", async (route) => {
    const catalog = await (await route.fetch()).json();
    const ids: string[] = catalog.lessons.map((entry: { id: string }) => entry.id);
    dropped = ids[ids.length - 1];
    published.splice(0, published.length, ...ids.sort());
    await route.fulfill({
      json: {
        ...catalog,
        lessons: catalog.lessons.filter((entry: { id: string }) => entry.id !== dropped),
        courses: catalog.courses.map((course: { lessonIds: string[] }) => ({
          ...course,
          lessonIds: course.lessonIds.filter((id) => id !== dropped),
        })),
      },
    });
  });
  return { published, unpublished: () => dropped };
}

test("«Учить курс» ставит все уроки курса, а новый урок подхватывается при следующем запуске", async ({ page }) => {
  const catalog = await withoutLastLesson(page);
  await page.goto("/app/");
  await ready(page);
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByRole("button", { name: "Учить курс" })).toHaveCount(0); // курс подписан
  const installed = async () =>
    page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("tetradio-mock-1");
        request.onsuccess = () => resolve(request.result);
      });
      const keys = await new Promise<string[]>((resolve) => {
        const all = database.transaction("packages").objectStore("packages").getAllKeys();
        all.onsuccess = () => resolve(all.result as string[]);
      });
      database.close();
      return keys.sort();
    });
  await expect.poll(installed).toEqual(catalog.published.filter((id) => id !== catalog.unpublished()));

  // Урок опубликован: подписанный курс доустанавливает его сам, без нажатий.
  await page.unroute("**/content/catalog.json");
  await page.goto("/app/");
  await ready(page);
  await expect.poll(installed, { timeout: 20000 }).toEqual(catalog.published);
});
