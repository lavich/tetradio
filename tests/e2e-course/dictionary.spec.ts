import { expect, test } from "../playwright-test";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await page.getByTestId("course-next").click();
  await expect(page.getByRole("article").first()).toBeVisible();
});

test("словарь: слова и фразы урока по группам, фильтр, лист слова ведёт в урок курса", async ({ page }) => {
  await page.goto("/app/words");
  const lesson = page.getByTestId("dictionary-lesson").first();
  await expect(lesson.getByRole("heading", { name: /1\.1.*Знакомство и είμαι/ })).toBeVisible();
  await expect(lesson.getByRole("link", { name: /είμαι/ })).toBeVisible();
  await expect(lesson.getByRole("link", { name: /Πώς σε λένε;/ })).toBeVisible(); // фраза — в словаре
  await expect(lesson.getByRole("img", { name: "не начато" }).first()).toBeVisible();
  await expect(page.getByTestId("word-count")).toHaveText("4 слова · 1 фраза");

  await page.getByRole("button", { name: /^закреплены/ }).click();
  await expect(page.getByTestId("dictionary-lesson")).toHaveCount(0);
  await page.getByRole("button", { name: /^все/ }).click();

  await page.getByRole("searchbox").fill("из");
  await expect(page.getByRole("region", { name: "Словарь" }).getByRole("link")).toHaveCount(1);
  await page.getByRole("link", { name: /από/ }).click();
  const sheet = page.getByTestId("entry-sheet");
  await expect(sheet).toContainText("из, от");
  await expect(sheet.getByRole("img", { name: "ещё не проверяли" }).first()).toBeVisible();
  await sheet.getByRole("link", { name: /Урок 1\.1/ }).click();
  await expect(page).toHaveURL(/\/course\/m01\/m01-1/);
});

test("широкое окно: словарь и открытое слово разворотом", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/words");
  await page.getByRole("link", { name: /Πώς σε λένε;/ }).click();
  await expect(page).toHaveURL(/\/words\/phrase\//);
  const row = page.getByRole("link", { name: /Πώς σε λένε;/ });
  await expect(row).toHaveAttribute("aria-current", "page");
  const list = (await page.getByRole("region", { name: "Словарь" }).boundingBox())!;
  const sheet = (await page.getByTestId("entry-sheet").boundingBox())!;
  expect(sheet.x).toBeGreaterThan(list.x + list.width);
  await expect(page.getByTestId("entry-sheet")).toContainText("Как тебя зовут?");
});

test("лист глагола: ряд основных форм, таблица по лицам, форма звучит по нажатию", async ({ page }) => {
  await page.addInitScript(() => {
    const greek = { lang: "el-GR", name: "Test Greek", voiceURI: "test-el", default: true, localService: true };
    const synth = {
      getVoices: () => [greek],
      speak(utterance: { text: string; onstart?: () => void; onend?: () => void }) {
        ((window as unknown as { __spoken: string[] }).__spoken ??= []).push(utterance.text);
        setTimeout(() => {
          utterance.onstart?.();
          utterance.onend?.();
        }, 5);
      },
      cancel() {},
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    class Utterance {
      constructor(public text: string) {}
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  });
  const spoken = () => page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken ?? []);
  await page.goto("/app/words");
  await page.getByRole("link", { name: /είμαι/ }).click();
  const sheet = page.getByTestId("entry-sheet");
  const row = sheet.getByTestId("verb-forms");
  await expect(row).toContainText("είμαι");
  await expect(row).toContainText("сейчас");
  await expect(row).toContainText("ήμουν");
  await expect(row).toContainText("было");
  await expect(row).toContainText("θα είμαι");
  await expect(row).toContainText("будет");

  await row.getByRole("button", { name: "Произнести: ήμουν" }).click();
  await expect.poll(spoken).toContain("ήμουν");

  const table = sheet.getByTestId("paradigm");
  await expect(table.getByRole("table")).toBeHidden();
  await table.getByText("Все формы").click();
  await expect(table.getByRole("row", { name: /^мы/ })).toContainText("είμαστε");
  await expect(table.getByRole("row", { name: /^мы/ })).toContainText("ήμασταν");
  await table.getByRole("button", { name: "Произнести: ήσουν" }).click();
  await expect.poll(spoken).toContain("ήσουν");
});
