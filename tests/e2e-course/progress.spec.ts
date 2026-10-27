import { expect, test } from "../playwright-test";

test("вкладка «Прогресс»: навыки по курсу, путь и темп, неделя, слова и «Настройки и данные»", async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole("heading", { name: "Прогресс", level: 1 })).toBeVisible();
  for (const skill of ["reading", "listening", "writing", "speaking"])
    await expect(page.getByTestId(`skill-${skill}`).getByRole("img", { name: "0 % курса" })).toBeVisible();
  await expect(page.getByTestId("skill-reading")).toContainText("ещё не начато");
  await expect(page.getByRole("img", { name: /пройдено уроков: 0 из/ })).toBeVisible();
  await expect(page.getByTestId("pace")).toContainText("До K1 (Контрольная A1");
  await expect(page.getByTestId("pace")).not.toContainText("Ваш темп"); // меньше недели истории
  await expect(page.getByTestId("week")).toHaveText("На этой неделе занятий ещё не было.");
  await expect(page.getByTestId("weeks").getByRole("list")).toHaveCount(0);
  await expect(page.getByTestId("cards-line")).toContainText(
    "Карточки появятся после первого выполненного задания урока",
  );
  await page.getByRole("link", { name: "Настройки и данные" }).click();
  await expect(page).toHaveURL(/\/progress\/settings$/);
  await expect(page.getByRole("heading", { name: "Копия", exact: true })).toBeVisible();
  // Служебные экраны остаются под вкладкой «Прогресс».
  await expect(page.getByRole("navigation").getByRole("link", { name: "Прогресс" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto("/app/more");
  await expect(page).toHaveURL(/\/progress$/);
  await page.goto("/app/more/backup");
  await expect(page).toHaveURL(/\/progress\/settings$/);
  await page.goto("/app/progress/stats");
  await expect(page).toHaveURL(/\/progress$/);
});

test("«Занятия по неделям»: 30 недель истории на 360 px — видна текущая неделя, экран не шире окна", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const lessonId = await new Promise<string>((resolve) => {
      const request = db.transaction("lessons").objectStore("lessons").getAllKeys();
      request.onsuccess = () => resolve(request.result[0] as string);
    });
    const tx = db.transaction("blockProgress", "readwrite");
    for (let week = 1; week <= 30; week++)
      for (const offset of [0, 2]) {
        const updatedAt = new Date(Date.now() - (week * 7 - offset) * 86_400_000).toISOString();
        const blockId = `seed-${week}-${offset}`;
        tx.objectStore("blockProgress").put({
          key: `${lessonId}/${blockId}`,
          lessonId,
          blockId,
          done: true,
          updatedAt,
        });
      }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.goto("/app/progress");
  const area = page.getByRole("region", { name: "Недели с начала занятий" });
  await expect(area.getByRole("listitem").last()).toContainText("Эта неделя");
  const atEnd = () =>
    area.evaluate((element) => ({
      overflow: element.scrollWidth > element.clientWidth,
      end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
    }));
  expect(await atEnd()).toEqual({ overflow: true, end: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(area).toHaveAttribute("tabindex", "0");

  await page.setViewportSize({ width: 1000, height: 780 });
  await page.setViewportSize({ width: 360, height: 780 });
  await expect.poll(atEnd).toEqual({ overflow: true, end: true });
});
