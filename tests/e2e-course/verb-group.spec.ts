import { expect, test } from "../playwright-test";
import { type Locator, type Page } from "@playwright/test";

const LONGEST = "гр. B как αγαπάω · неправ. прош.";
const LABELS: [string, string | null][] = [
  ["Γράφω", "гр. A"],
  ["Μπορείς", "гр. B как μπορώ"],
  ["Αγαπάμε", "гр. B как αγαπάω"],
  ["Ρωτάς", LONGEST],
  ["Έρχεται", "на -μαι · неправ. прош."],
  ["Τρώμε", "гр. A · неправ. прош."],
  ["Βρέχει", null],
];

async function startModule(page: Page) {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await page.goto("/app/course/m01");
  await expect(page.getByText("скачивается…")).toHaveCount(0);
}
const seen = (label: Locator) => label.locator("[aria-hidden]");
async function inside(inner: Locator, outer: Locator) {
  const [a, b] = [(await inner.boundingBox())!, (await outer.boundingBox())!];
  expect(a.x).toBeGreaterThanOrEqual(b.x - 0.5);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
}
async function above(label: Locator, row: Locator) {
  const [a, b] = [(await label.boundingBox())!, (await row.boundingBox())!];
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + 0.5);
}
async function turnTo(page: Page, name: string) {
  const target = page.getByRole("region", { name });
  const sheet = page.getByRole("article").first();
  const forward = page
    .getByRole("navigation", { name: "Страницы урока" })
    .getByRole("button", { name: /Далее|К итогу/ });
  await expect(sheet).toHaveAttribute("aria-label", /^Страница/);
  for (let turns = 0; turns < 20 && !(await target.count()); turns++) {
    const before = await sheet.getAttribute("aria-label");
    await forward.click();
    await expect(sheet).not.toHaveAttribute("aria-label", before!);
  }
  await expect(target).toBeVisible();
  return target;
}
const pageWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

for (const width of [390, 320])
  test(`подсказка по нажатию в уроке: метка каждой группы, у безличного нет, ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await startModule(page);
    await page.goto("/app/course/m01/m01-r1?p=2");
    for (const [form, text] of LABELS) {
      await page.getByRole("button", { name: `Произнести и перевести: ${form}`, exact: true }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      const label = sheet.getByTestId("verb-group");
      if (text === null) await expect(label).toHaveCount(0);
      else {
        await expect(seen(label)).toHaveText(text);
        await inside(label, sheet);
        await above(label, sheet.getByTestId("verb-forms"));
      }
      expect(await pageWidth(page)).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
    }
  });

for (const width of [390, 320])
  test(`список слов урока: метка над формами, у безличного нет, ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await startModule(page);
    await page.goto("/app/course/m01/m01-r1?p=1");
    const words = await turnTo(page, "Слова урока");
    for (const [greek, text] of [
      ["γράφω", "гр. A"],
      ["ρωτάω", LONGEST],
      ["έρχομαι", "на -μαι · неправ. прош."],
      ["βρέχει", null],
    ] as const) {
      const row = words.getByRole("button", { name: new RegExp(`^Произнести: ${greek}`) });
      const label = row.getByTestId("verb-group");
      if (text === null) {
        await expect(row).toBeVisible();
        await expect(label).toHaveCount(0);
        continue;
      }
      await expect(seen(label)).toHaveText(text);
      await inside(label, row);
      await above(label, row.getByTestId("verb-forms"));
    }
    await expect(words.getByRole("button", { name: /^Произнести: ρωτάω/ })).toHaveAccessibleName(
      /^Произнести: ρωτάω ?, группа B ?, как αγαπάω ?, неправильное прошедшее/,
    );
    expect(await pageWidth(page)).toBeLessThanOrEqual(width);
  });

test("после ответа в упражнении: метка τρώω", async ({ page }) => {
  await startModule(page);
  await page.goto("/app/words/troo/exercise/recognition");
  await expect(page.getByTestId("verb-group")).toHaveCount(0);
  await page.getByRole("button", { name: "есть, кушать" }).click();
  await expect(seen(page.getByTestId("verb-group"))).toHaveText("гр. A · неправ. прош.");
});

test("лист слова в тёмной теме: рамка метки — цвет её текста с прозрачностью, 320 px без переполнения", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await startModule(page);
  await page.goto("/app/words/rotao");
  const sheet = page.getByTestId("entry-sheet");
  const label = sheet.getByTestId("verb-group");
  await expect(seen(label)).toHaveText(LONGEST);
  await inside(label, sheet);
  await above(label, sheet.getByTestId("verb-forms"));
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const { border, color } = await label.evaluate((node) => {
    const style = getComputedStyle(node);
    return { border: style.borderTopColor, color: style.color };
  });
  const rgba = (value: string) => {
    const numbers = value.match(/[\d.]+/g)!.map(Number);
    const [r, g, b, a = 1] = value.startsWith("color(") ? numbers : numbers;
    const scale = value.startsWith("color(") ? 255 : 1;
    return { rgb: [r, g, b].map((v) => Math.round(v * scale)), alpha: a };
  };
  expect(rgba(border).alpha).toBeLessThan(1);
  expect(rgba(border).rgb).toEqual(rgba(color).rgb);
  expect(await pageWidth(page)).toBeLessThanOrEqual(320);
});
