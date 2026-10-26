import { expect, test } from "../playwright-test";
import { installLessons, ready } from "./helpers";
import { openTelegram, tg } from "./telegram";

const profileKeys = (page: import("@playwright/test").Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("tetradio:haptics:tetradio-tg-")));

test("удаление данных в Telegram: облако и устройство очищены, старт как у нового пользователя", async ({ page }) => {
  await openTelegram(page, { cloud: { p_other: "{}", v_other_0: "x", cp_other: "{}" } });
  await installLessons(page, ["mech-1"]);
  await expect(page.getByTestId("today-title")).not.toHaveText("Выберите курс");
  await page.evaluate(() => localStorage.setItem("tetradio:feedback-draft", "черновик"));
  await page.goto("/app/progress/settings");
  await page.getByRole("button", { name: "Удалить мои данные…" }).click();
  await expect(page.getByText("На других устройствах удаление нужно повторить")).toBeVisible();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await ready(page);
  await expect(page.getByTestId("today-title")).toHaveText("Выберите курс");
  const appKeys = Object.keys(await tg(page).cloud()).filter((key) => /^(p_|v_|cp_)/.test(key));
  expect(appKeys.filter((key) => key.endsWith("other") || key.includes("_other_"))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("tetradio:feedback-draft"))).toBeNull();
});

test("запуск с отметкой прерванного удаления доводит его до конца", async ({ page }) => {
  await openTelegram(page);
  await installLessons(page, ["mech-1"]);
  await expect(page.getByTestId("today-title")).not.toHaveText("Выберите курс");
  await page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((database) => database.name ?? "");
    const name = names.find((candidate) => candidate.startsWith("tetradio-tg-"))!;
    localStorage.setItem(`tetradio:erasing:${name}`, "local");
  });
  await page.reload();
  await ready(page);
  await expect(page.getByTestId("today-title")).toHaveText("Выберите курс");
  expect(await profileKeys(page)).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("tetradio:erasing:")))).toBe(
    false,
  );
});
