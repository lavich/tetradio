import { expect, test } from "../playwright-test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installLessons, ready, recordPlays } from "./helpers";

test("полная копия переносит слова, уроки и медиа в чистый профиль", async ({ browser }) => {
  const source = await browser.newContext();
  await recordPlays(source);
  const page = await source.newPage();
  await page.goto("/app/");
  await ready(page);
  await installLessons(page, ["mech-2"]);
  // Запись слова скачивает первое прослушивание.
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await page.getByRole("searchbox").fill("πόλη");
  await page.getByRole("link", { name: /η πόλη/ }).click();
  await page.getByRole("button", { name: "Послушать слово" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __played: string[] }).__played.length)).toBe(1);

  await page.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await page.getByRole("link", { name: "Настройки и данные" }).click();
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Сохранить полную копию" }).click(),
  ]).then(([item]) => item);
  const file = join(tmpdir(), `tetradio-e2e-${Date.now()}.json`);
  writeFileSync(file, readFileSync(await download.path()));
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  expect(parsed.data.databaseName).toBe("tetradio-mock-1");
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
  // Запись «η πόλη» скачана при прослушивании и входит в копию; остальные медиа не тянулись.
  expect(parsed.data.tables.find((table: { name: string }) => table.name === "assets").rowCount).toBe(1);
  // Курс подписан открытием урока, поэтому в профиле лежат пакеты всех его уроков — по одному на урок.
  const rows = (name: string) => parsed.data.tables.find((table: { name: string }) => table.name === name).rowCount;
  expect(rows("packages")).toBe(rows("lessons"));
  expect(rows("packages")).toBeGreaterThan(1);
  await source.close();

  const clean = await browser.newContext();
  await recordPlays(clean);
  // Запись приходит из восстановленной базы: сеть к файлам медиа закрыта.
  await clean.route("**/content/media/**", (route) => route.abort());
  const fresh = await clean.newPage();
  await fresh.goto("/app/");
  await ready(fresh);
  await fresh.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await fresh.getByRole("link", { name: "Настройки и данные" }).click();
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
  await fresh.getByRole("searchbox").fill("πόλη");
  await fresh.getByRole("link", { name: /η πόλη/ }).click();
  await fresh.getByRole("button", { name: "Послушать слово" }).click();
  await expect
    .poll(() => fresh.evaluate(() => (window as unknown as { __played: string[] }).__played))
    .toEqual([expect.stringMatching(/^blob:/)]);
  await fresh.goto("/app/words");
  await expect(fresh.getByRole("link", { name: /ο φίλος/ })).toBeVisible(); // уроки и слова на месте
  await clean.close();
});

test("повреждённый и чужой файл не меняют данные", async ({ page }) => {
  await page.goto("/app/");
  await ready(page);
  await installLessons(page, ["mech-2"]);
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  // Курс догружается фоном: ждём устоявшийся словарь, иначе снимок поймает промежуточное число.
  await expect(page.getByTestId("word-count")).toHaveText("56 слов · 7 фраз");
  const before = await page.getByTestId("word-count").innerText();
  await page.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await page.getByRole("link", { name: "Настройки и данные" }).click();
  const broken = join(tmpdir(), "tetradio-broken.json");
  writeFileSync(broken, "{не json");
  await page.locator("#backup").setInputFiles(broken);
  await expect(page.getByText(/не читается как копия/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Заменить данные копией" })).toHaveCount(0);

  const alien = join(tmpdir(), "tetradio-alien.json");
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

  const future = join(tmpdir(), "tetradio-future.json");
  writeFileSync(
    future,
    JSON.stringify({
      formatName: "dexie",
      formatVersion: 1,
      data: { databaseName: "tetradio", databaseVersion: 10, tables: [], data: [] },
    }),
  );
  await page.locator("#backup").setInputFiles(future);
  await expect(page.getByText(/более новой версией/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Заменить данные копией" })).toHaveCount(0);

  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await expect(page.getByTestId("word-count")).toHaveText(before); // словарь не изменился
});
