import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installLessons, ready } from "./helpers";

test("полная копия переносит слова, правки и медиа в чистый профиль", async ({ browser }) => {
  const source = await browser.newContext();
  const page = await source.newPage();
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-2"]);
  // Правка, которой нет в исходном наборе: по ней и проверяем перенос.
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await page.getByRole("searchbox").fill("σπίτι");
  await page.getByRole("link", { name: /το σπίτι/ }).click();
  await page.getByRole("link", { name: "Редактировать слово" }).click();
  await page.locator("#russian").fill("дом (моя правка)");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено.")).toBeVisible();

  await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
  await page.getByRole("link", { name: /Копия данных/ }).click();
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Сохранить полную копию" }).click(),
  ]).then(([item]) => item);
  const file = join(tmpdir(), `lexi-e2e-${Date.now()}.json`);
  writeFileSync(file, readFileSync(await download.path()));
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  expect(parsed.data.databaseName).toBe("lexi");
  // Копия старой версии без расписания должна читаться как незаданное расписание.
  for (const row of parsed.data.data.find((table: { tableName: string }) => table.tableName === "settings").rows) {
    delete row.schedule;
    for (const key of Object.keys(row.$types ?? {})) if (key.startsWith("schedule")) delete row.$types[key];
  }
  writeFileSync(file, JSON.stringify(parsed));
  expect(parsed.data.tables.map((table: { name: string }) => table.name)).toEqual(
    expect.arrayContaining([
      "words",
      "phrases",
      "lessonItems",
      "packages",
      "media",
      "assets",
      "cardStates",
      "events",
      "sessions",
      "settings",
      "meta",
    ]),
  );
  // Картинка σπίτι скачана при просмотре карточки и входит в копию; остальные медиа не тянулись.
  expect(parsed.data.tables.find((table: { name: string }) => table.name === "assets").rowCount).toBe(1);
  // Курс подписан открытием урока, поэтому в профиле лежат пакеты всех его уроков — по одному на урок.
  const rows = (name: string) => parsed.data.tables.find((table: { name: string }) => table.name === name).rowCount;
  expect(rows("packages")).toBe(rows("lessons"));
  expect(rows("packages")).toBeGreaterThan(1);
  await source.close();

  const clean = await browser.newContext();
  const fresh = await clean.newPage();
  await fresh.goto("/");
  await ready(fresh);
  await fresh.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();
  await fresh.getByRole("button", { name: "Задать расписание" }).click();
  await fresh.locator("#start").fill("2026-12-01");
  await fresh.getByRole("button", { name: "Пн", exact: true }).click();
  await fresh.getByRole("button", { name: "Сохранить" }).click();
  await expect(fresh.getByText(/Пн, первое занятие/)).toBeVisible();
  await fresh.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
  await fresh.getByRole("link", { name: /Копия данных/ }).click();
  await fresh.locator("#backup").setInputFiles(file);
  await expect(fresh.getByText(/Файл проверен/)).toBeVisible();
  await fresh.getByRole("button", { name: "Заменить данные копией" }).click();
  await expect(fresh.getByRole("alertdialog")).toBeVisible();
  const [saved] = await Promise.all([
    fresh.waitForEvent("download"),
    fresh.getByRole("button", { name: "Заменить", exact: true }).click(),
  ]);
  expect(saved.suggestedFilename()).toContain("before-restore");
  await expect(fresh.getByText("Данные восстановлены полностью.")).toBeVisible();
  await fresh.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await fresh.getByRole("searchbox").fill("σπίτι");
  await fresh.getByRole("link", { name: /το σπίτι/ }).click();
  await expect(fresh.getByText("дом (моя правка)")).toBeVisible();
  await expect(fresh.getByTestId("word-art")).toBeVisible();
  await fresh.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();
  await expect(fresh.getByText("Не задано — даты уроков назначаются вручную")).toBeVisible();
  await clean.close();
});

test("повреждённый и чужой файл не меняют данные", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-2"]);
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  // Курс догружается фоном: ждём устоявшийся словарь, иначе снимок поймает промежуточное число.
  await expect(page.getByTestId("word-count")).toHaveText("Показано 50 слов, есть ещё");
  const before = await page.getByTestId("word-count").innerText();
  await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
  await page.getByRole("link", { name: /Копия данных/ }).click();
  const broken = join(tmpdir(), "lexi-broken.json");
  writeFileSync(broken, "{не json");
  await page.locator("#backup").setInputFiles(broken);
  await expect(page.getByText(/не читается как копия/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Заменить данные копией" })).toBeDisabled();

  const alien = join(tmpdir(), "lexi-alien.json");
  writeFileSync(
    alien,
    JSON.stringify({
      formatName: "dexie",
      formatVersion: 1,
      data: { databaseName: "other", databaseVersion: 1, tables: [], data: [] },
    }),
  );
  await page.locator("#backup").setInputFiles(alien);
  await expect(page.getByText(/другим приложением/)).toBeVisible();

  const future = join(tmpdir(), "lexi-future.json");
  writeFileSync(
    future,
    JSON.stringify({
      formatName: "dexie",
      formatVersion: 1,
      data: { databaseName: "lexi", databaseVersion: 9, tables: [], data: [] },
    }),
  );
  await page.locator("#backup").setInputFiles(future);
  await expect(page.getByText(/более новой версией/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Заменить данные копией" })).toBeDisabled();

  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await expect(page.getByTestId("word-count")).toHaveText(before); // словарь не изменился
});
