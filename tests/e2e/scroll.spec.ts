import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../playwright-test";
import { installLessons } from "./helpers";

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
const settled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = -1;
        let still = 0;
        const tick = () => {
          still = window.scrollY === last ? still + 1 : 0;
          last = window.scrollY;
          if (still >= 5) resolve(Math.round(last));
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
/** Колесом, как пользователь: уроки по пути показываются и запоминают свою высоту (content-visibility). */
async function wheelTo(page: Page, target: Locator, top = 200, step = 100) {
  await page.mouse.move(200, 200);
  for (let turn = 0; turn < 100 && (await target.boundingBox())!.y > top; turn++) {
    await page.mouse.wheel(0, step);
    await settled(page);
  }
  return settled(page);
}
const sections = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-testid=dictionary-lesson]")].map((section) => ({
      rows: section.querySelectorAll("li").length,
      height: section.getBoundingClientRect().height,
    })),
  );

test.beforeEach(async ({ page }) => {
  await installLessons(page, ["mech-1", "mech-2", "mech-3", "mech-4"]);
});

test("поиск и фильтр живут в адресе: «Назад» со слова возвращает их, даже если слово открыто сразу после ввода", async ({
  page,
}) => {
  await page.goto("/app/words?filter=learning");
  await expect(page.getByRole("button", { name: /^учу/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^все/ }).click();
  await expect(page).toHaveURL(/\/words$/);

  const list = page.getByRole("region", { name: "Словарь" });
  await page.getByRole("searchbox").fill("φίλ");
  await list.getByRole("link", { name: /ο φίλος/ }).click();
  await expect(page.getByTestId("entry-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page).toHaveURL(/\/words\?q=/);
  await expect(page.getByRole("searchbox")).toHaveValue("φίλ");
  await expect(list.getByRole("link")).toHaveCount(await list.getByRole("link", { name: /φίλ/ }).count());
});

test("«Назад» возвращает строку на её место, переход в другой раздел открывается сверху", async ({ page }) => {
  // Низкое окно: «Прогресс» тоже прокручивается, иначе браузер прижал бы его к верху и без сброса.
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto("/app/words");
  const list = page.getByRole("region", { name: "Словарь" });
  const target = list.getByRole("link").nth(40);
  const before = await wheelTo(page, target);
  const href = await target.getAttribute("href");
  const box = (await target.boundingBox())!;
  expect(before).toBeGreaterThan(1000);
  await target.click();
  await expect(page.getByTestId("entry-sheet")).toBeVisible();
  expect(await scrollY(page)).toBe(0);

  await page.goBack();
  await expect.poll(() => scrollY(page)).toBe(before);
  await expect.poll(async () => (await list.locator(`a[href="${href}"]`).boundingBox())!.y).toBeCloseTo(box.y, 0);

  await page.getByRole("navigation", { name: "Основные разделы" }).getByRole("link", { name: "Прогресс" }).click();
  await expect(list).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
    .toBeGreaterThan(100);
  expect(await scrollY(page)).toBe(0);
});

test("замена адреса фильтром не теряет позицию; новая загрузка вкладки чужую позицию не берёт", async ({ page }) => {
  await page.goto("/app/words");
  await expect(page.getByTestId("dictionary-lesson").first()).toBeVisible();
  await page.mouse.move(200, 400);
  await page.mouse.wheel(0, 120);
  const before = await settled(page);
  expect(before).toBeGreaterThan(50);
  await page.getByRole("button", { name: /^все/ }).click();
  await page.getByRole("region", { name: "Словарь" }).getByRole("link").nth(3).click();
  await expect(page.getByTestId("entry-sheet")).toBeVisible();
  await page.goBack();
  await expect.poll(() => scrollY(page)).toBe(before);

  // Другой адрес: переход на тот же Chromium считает перезагрузкой, а у неё позиция законно возвращается.
  await page.goto("/app/words?filter=all");
  await expect(page.getByTestId("dictionary-lesson").first()).toBeVisible();
  expect(await settled(page)).toBe(0);
});

test("после поиска под найденным нет пустоты, после очистки список прежней высоты", async ({ page }) => {
  // Низкое окно: найденное длиннее экрана, нижние уроки остаются непоказанными со старой высотой.
  await page.setViewportSize({ width: 390, height: 320 });
  await page.goto("/app/words");
  const list = page.getByRole("region", { name: "Словарь" });
  await wheelTo(page, list.getByRole("link").last(), 200, 300);
  const full = await page.evaluate(() => document.documentElement.scrollHeight);

  await page.getByRole("searchbox").fill("ο");
  await expect(page).toHaveURL(/q=/);
  for (const { rows, height } of await sections(page)) expect(height).toBeLessThan(rows * 72 + 120);
  await page.getByRole("searchbox").fill("");
  await expect(page).toHaveURL(/\/words$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeCloseTo(full, -2);
});

test("разворот: слово открывается рядом, список остаётся на месте, отметка переходит к новому слову", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/app/words");
  const list = page.getByRole("region", { name: "Словарь" });
  const first = list.getByRole("link").nth(30);
  const before = await wheelTo(page, first, 300);
  expect(before).toBeGreaterThan(500);
  await first.click();
  await expect(page.getByTestId("entry-sheet")).toBeVisible();
  await expect(first).toHaveAttribute("aria-current", "page");
  await expect.poll(() => scrollY(page)).toBe(before);

  const other = list.getByRole("link").nth(5);
  await other.click();
  await expect(other).toHaveAttribute("aria-current", "page");
  await expect(first).not.toHaveAttribute("aria-current", "page");
  const lessonOf = (row: Locator) => row.evaluate((link) => link.closest("section")?.getAttribute("aria-label"));
  expect(await lessonOf(other)).not.toBe(await lessonOf(first));
});
