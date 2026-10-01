import { expect, test, type Page } from "@playwright/test";
import { addDays } from "../../src/domain/learning";
import { nextLessonDay } from "../../src/domain/schedule";
import { dayMonth } from "../../src/shared/format";
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
  await page.goto("/");
  await ready(page);
  await page.getByRole("navigation").getByRole("link", { name: "Курс" }).click();
  await expect(page.getByRole("heading", { name: "Механики" })).toBeVisible();

  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByRole("button", { name: "Учить курс" })).toHaveCount(0); // курс подписан
  await expect(page.getByRole("link", { name: /не загружен/ })).toHaveCount(0);
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
  await page.goto("/");
  await ready(page);
  await expect.poll(installed, { timeout: 20000 }).toEqual(catalog.published);
});

test("у курса своё расписание и свой предел; соседний курс их не подхватывает", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("navigation").getByRole("link", { name: "Курс" }).click();
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByRole("button", { name: "Учить курс" })).toHaveCount(0);

  const mechanics = page.locator("section").filter({ has: page.getByRole("heading", { name: "Механики" }) });

  // Предлог «К» достаётся только предстоящему занятию, поэтому первое занятие — ближайший будущий понедельник.
  const monday = nextLessonDay(new Date().toISOString().slice(0, 10), [1], false);
  const third = addDays(monday, 14);
  const link = (text: string) => new RegExp(text.replace(/\./g, "\\."));
  await mechanics.getByRole("button", { name: "Задать расписание" }).click();
  await mechanics.getByLabel("Первое занятие").fill(monday);
  await mechanics.getByRole("button", { name: "Пн", exact: true }).click();
  await mechanics.getByRole("button", { name: "Сохранить" }).click();
  await expect(mechanics.getByText(`Пн, первое занятие ${dayMonth(monday)}`)).toBeVisible();
  await expect(mechanics.getByRole("link", { name: link(`1.1 · К понедельнику, ${dayMonth(monday)}`) })).toBeVisible();
  await expect(mechanics.getByRole("link", { name: link(`1.3 · ${dayMonth(third)}`) })).toBeVisible(); // не ближайшее занятие — только дата

  // Предел тоже принадлежит курсу.
  await mechanics.getByLabel("Новых карточек в день").fill("3");
  await mechanics.getByLabel("Новых карточек в день").blur();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open("tetradio-mock-1");
          request.onsuccess = () => resolve(request.result);
        });
        const rows = await new Promise<{ id: string; newItemsPerDay: number }[]>((resolve) => {
          const all = database.transaction("courses").objectStore("courses").getAll();
          all.onsuccess = () => resolve(all.result as { id: string; newItemsPerDay: number }[]);
        });
        database.close();
        return Object.fromEntries(rows.map((row) => [row.id, row.newItemsPerDay]));
      }),
    )
    .toEqual({ mechanics: 3, my: 12 }); // служебный локальный курс остаётся на пределе по умолчанию
});

test("список часов занятия остаётся на экране и прокручивается внутри себя", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("navigation").getByRole("link", { name: "Курс" }).click();
  await page.getByRole("button", { name: "Учить курс" }).click();
  const mechanics = page.locator("section").filter({ has: page.getByRole("heading", { name: "Механики" }) });
  await mechanics.getByRole("button", { name: "Задать расписание" }).click();
  await mechanics.getByLabel("Время занятия").click();

  const popup = page.locator('[data-slot="select-content"]');
  await expect(popup).toBeVisible();
  const box = await popup.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
      scrollable: node.scrollHeight > node.clientHeight,
      viewport: window.innerHeight,
    };
  });
  // Двадцать четыре часа целиком на экран не помещаются ни на одном телефоне: список обязан прокручиваться,
  // а не разворачиваться во весь рост и уезжать под шапку клиента.
  expect(box.scrollable).toBe(true);
  expect(box.height).toBeLessThanOrEqual(280);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(box.viewport);
});
