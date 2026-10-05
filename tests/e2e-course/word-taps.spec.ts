import { expect, test, type Page } from "@playwright/test";

/** Синтез речи подменяется: `none` — греческого голоса нет, `instant` — голос есть, реплики записываются в `__spoken`. */
async function voices(page: Page, mode: "none" | "instant") {
  await page.addInitScript((mode) => {
    const greek = { lang: "el-GR", name: "Test Greek", voiceURI: "test-el", default: true, localService: true };
    const synth = {
      getVoices: () => (mode === "none" ? [] : [greek]),
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
  }, mode);
}
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken ?? []);
const stroked = (page: Page, name: string, index = 0) =>
  page
    .getByRole("button", { name: `Произнести и перевести: ${name}`, exact: true })
    .nth(index)
    .evaluate((node) => getComputedStyle(node).backgroundImage !== "none");

async function turnTo(page: Page, name: string) {
  const target = page.getByRole("region", { name });
  const sheet = page.getByRole("article").first();
  const forward = page
    .getByRole("navigation", { name: "Страницы урока" })
    .getByRole("button", { name: /Далее|К итогу/ });
  for (let turns = 0; turns < 20 && !(await target.count()); turns++) {
    const before = await sheet.getAttribute("aria-label");
    await forward.click();
    await expect(sheet).not.toHaveAttribute("aria-label", before!);
  }
  await expect(target).toBeVisible();
  return target;
}

async function start(page: Page, lesson: string) {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await page.goto("/app/course/m01");
  await expect(page.getByText("скачивается…")).toHaveCount(0);
  await page.goto(`/app/course/m01/${lesson}?p=1`);
}

test("слово урока в объяснении: звучит карточка, подсказка с переводом; штрих — только у первого вхождения", async ({
  page,
}) => {
  await voices(page, "instant");
  await start(page, "m01-1");
  const hint = page.getByRole("note").filter({ hasText: "Нажмите на слово — услышите его и увидите перевод" });
  await expect(hint).toBeVisible();
  const explanation = page.getByRole("region", { name: "Глагол είμαι — «быть»" });
  const word = explanation.getByRole("button", { name: "Произнести и перевести: Είμαι", exact: true });
  await expect(word).toHaveCount(2);
  expect(await stroked(page, "Είμαι", 0)).toBe(true);
  expect(await stroked(page, "Είμαι", 1)).toBe(false);
  expect(await stroked(page, "από")).toBe(true);

  await word.first().click();
  await expect.poll(() => spoken(page)).toContain("είμαι");
  const sheet = page.getByRole("dialog", { name: "είμαι" });
  await expect(sheet).toContainText("быть");
  await expect(sheet).toContainText("θα είμαι");
  await expect(sheet).not.toContainText("Из урока");
  await expect(word.first()).toHaveAttribute("aria-expanded", "true");
  // Облачко листания не перекрывает подсказку: в её середине — сама подсказка.
  const box = (await sheet.boundingBox())!;
  expect(
    await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("[role=dialog]"), {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }),
  ).toBe(true);
  await expect(hint).toHaveCount(0);
  await sheet.getByRole("button", { name: "Ещё раз" }).click();
  await expect.poll(async () => (await spoken(page)).length).toBe(2);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await explanation.getByRole("button", { name: "Произнести и перевести: από", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "από" })).toBeVisible();
  await page.mouse.click(5, 400);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(explanation).toBeVisible();
  await expect(hint).toHaveCount(0);
});

test("с клавиатуры: Enter открывает подсказку и переводит фокус, Esc возвращает его слову", async ({ page }) => {
  await voices(page, "instant");
  await start(page, "m01-1");
  const word = page.getByRole("button", { name: "Произнести и перевести: από", exact: true }).first();
  await word.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "από" }).getByRole("button", { name: "Ещё раз" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(word).toBeFocused();
});

test("слово прошлого урока не выделено, но нажимается: подсказка «Из урока 1.1»", async ({ page }) => {
  await voices(page, "instant");
  await start(page, "m01-r1");
  const word = page.getByRole("button", { name: "Произнести и перевести: είμαστε", exact: true });
  await expect(word).toBeVisible();
  expect(await stroked(page, "είμαστε")).toBe(false);
  await word.click();
  const sheet = page.getByRole("dialog", { name: "είμαι" });
  await expect(sheet).toContainText("Из урока 1.1");
  await expect(sheet).toContainText("быть");
  await expect.poll(() => spoken(page)).toContain("είμαι");
});

test("в заданиях слов-кнопок нет; транскрипт размечен только после того, как открыт", async ({ page }) => {
  await voices(page, "instant");
  await start(page, "m01-1");
  const forms = await turnTo(page, "Формы είμαι");
  await expect(forms.getByRole("button", { name: /^Произнести и перевести/ })).toHaveCount(0);
  const listening = await turnTo(page, "Аудирование: Στο καφέ");
  await expect(page.getByRole("button", { name: /^Произнести и перевести/ })).toHaveCount(0);
  const play = listening.getByRole("button", { name: "Слушать" });
  await play.click();
  await expect(listening).toContainText("Прослушано 1 из 2");
  await play.click();
  await expect(listening).toContainText("Прослушано 2 из 2");
  await listening.getByRole("button", { name: "Открыть текст" }).click();
  const phrase = listening.getByRole("button", { name: "Произнести и перевести: Πώς σε λένε", exact: true });
  await phrase.click();
  await expect(page.getByRole("dialog", { name: "Πώς σε λένε;" })).toContainText("Как тебя зовут?");
  await expect.poll(() => spoken(page)).toContain("Πώς σε λένε;");
});

test("нет греческого голоса: подсказка с переводом и строкой о голосе", async ({ page }) => {
  await voices(page, "none");
  await start(page, "m01-1");
  await page.getByRole("button", { name: "Произнести и перевести: από", exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: "από" });
  await expect(sheet).toContainText("из, от");
  await expect(sheet).toContainText("На устройстве нет греческого голоса — включите его в настройках речи.");
});

test("слова в таблице объяснения нажимаются так же, как в тексте", async ({ page }) => {
  await voices(page, "instant");
  await start(page, "m01-1");
  const table = page.getByRole("region", { name: "Глагол είμαι — «быть»" }).getByRole("table");
  const cell = table.getByRole("button", { name: "Произнести и перевести: είσαι", exact: true });
  await expect(cell).toBeVisible();
  await cell.click();
  await expect.poll(() => spoken(page)).toContain("είμαι");
  await expect(page.getByRole("dialog", { name: "είμαι" })).toContainText("быть");
});
