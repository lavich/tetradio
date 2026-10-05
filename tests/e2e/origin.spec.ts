import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installLessons, ready } from "./helpers";

/**
 * Смена адреса приложения: `localhost` и `127.0.0.1` — два разных origin одного сервера, как старый и новый хостинг.
 * IndexedDB не переезжает редиректом; переносит только полная копия, восстановленная в чистом профиле нового адреса.
 */
test("данные не переходят между origin сами; перенос — экспорт на старом адресе и импорт на новом", async ({
  browser,
  baseURL,
}) => {
  const port = new URL(baseURL!).port;
  const old = await browser.newContext({ baseURL: `http://localhost:${port}` });
  const page = await old.newPage();
  await page.goto("/app/");
  await ready(page);
  await installLessons(page, ["mech-2"]);
  await page.goto("/app/words");
  // Подписанный курс догружается фоном: копию снимаем с устоявшегося словаря и с ним же сверяем перенос.
  await expect(page.getByTestId("word-count")).toHaveText("56 слов · 7 фраз");
  const source = await page.getByTestId("word-count").innerText();
  await page.goto("/app/progress/backup");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Сохранить полную копию" }).click(),
  ]);
  const file = join(tmpdir(), `tetradio-origin-${Date.now()}.json`);
  writeFileSync(file, readFileSync(await download.path()));
  await old.close();

  const fresh = await browser.newContext({ baseURL: `http://127.0.0.1:${port}` });
  const moved = await fresh.newPage();
  await moved.goto("/app/");
  await ready(moved);
  await moved.goto("/app/words");
  await expect(moved.getByTestId("word-count")).toHaveText("0 слов"); // новый origin пуст: редирект ничего бы не перенёс
  await moved.goto("/app/progress/backup");
  await moved.locator("#backup").setInputFiles(file);
  await expect(moved.getByText(/Файл проверен/)).toBeVisible();
  await moved.getByRole("button", { name: "Заменить данные копией" }).click();
  await Promise.all([
    moved.waitForEvent("download"),
    moved.getByRole("button", { name: "Заменить", exact: true }).click(),
  ]);
  await expect(moved.getByText("Данные восстановлены полностью.")).toBeVisible();
  await moved.goto("/app/words");
  await expect(moved.getByTestId("word-count")).toHaveText(source);
  await fresh.close();
});
