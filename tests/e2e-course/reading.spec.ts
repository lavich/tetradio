import { expect, test, type Page } from "@playwright/test";

/** Греческий голос есть, каждая фраза «звучит» мгновенно; сказанное копится в `__spoken`. */
async function voice(page: Page) {
  await page.addInitScript(() => {
    const greek = { lang: "el-GR", name: "Test Greek", voiceURI: "test-el", default: true, localService: true };
    const synth = {
      getVoices: () => [greek],
      speaking: false,
      pending: false,
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
}
/** Урок пройден без прохождения всех заданий: проверяется полка, а не урок. */
const complete = (page: Page, lessonId: string) =>
  page.evaluate(async (lessonId) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("lessons", "readwrite");
    const store = tx.objectStore("lessons");
    const request = store.get(lessonId);
    request.onsuccess = () => store.put({ ...request.result, completed: true });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, lessonId);

test("полка «Чтение»: текст открывается после урока, звучит по предложениям, отметку можно снять", async ({ page }) => {
  await voice(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();

  await page.goto("/app/course/m01");
  const shelf = page.getByRole("list", { name: "Чтение" });
  await expect(shelf.getByRole("listitem")).toHaveCount(2);
  await expect(shelf).toContainText("откроется после урока «Знакомство и είμαι»");
  await expect(shelf.getByRole("link")).toHaveCount(0);
  await page.goto("/app/");
  await expect(page.getByTestId("today-title")).toBeAttached();
  await expect(page.getByTestId("reading-next")).toHaveCount(0);

  await complete(page, "m01-1");
  await page.goto("/app/");
  await expect(page.getByTestId("reading-next")).toHaveText("Почитать: Η Άννα, 28 слов");
  await page.getByTestId("reading-next").getByRole("link").click();

  await expect(page.getByRole("heading", { name: "Η Άννα", level: 1 })).toBeVisible();
  await expect(page.getByText("28 слов · Сгенерированный текст, носитель не вычитывал")).toBeVisible();
  // Весь текст звучит предложение за предложением; греческий «;» синтез произносит вопросом.
  await page.getByRole("button", { name: "Слушать" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken ?? []))
    .toEqual([
      "Γεια!",
      "Καλημέρα!",
      "Είμαι η Άννα.",
      "Είμαι από τη Ρωσία.",
      "Μένω στη Λεμεσό.",
      "— Γεια σου!",
      "Πώς σε λένε?",
      "— Είμαι η Άννα.",
      "Είσαι από την Κύπρο?",
      "— Είμαι από την Κύπρο.",
    ]);
  // Слово с подсказкой доступно с клавиатуры и называется для экранной читалки.
  const word = page.getByRole("button", { name: /^Произнести и перевести: Καλημέρα/ });
  await word.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("доброе утро");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Прочитано" }).click();
  await expect(page.getByTestId("reading-done")).toContainText("Прочитано");
  await expect(page.getByRole("button", { name: "Следующий текст" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "К модулю" })).toBeVisible();
  await page.getByRole("button", { name: "Снять отметку" }).click();
  await expect(page.getByRole("button", { name: "Прочитано" })).toBeVisible();
  await page.getByRole("button", { name: "Прочитано" }).click();

  await page.getByRole("button", { name: "К модулю" }).click();
  await expect(shelf.getByRole("listitem").first()).toContainText("прочитано");
  await expect(shelf.getByRole("link")).toHaveCount(1);
  await page.goto("/app/");
  await expect(page.getByRole("heading", { name: "Сегодня" })).toBeAttached();
  await expect(page.getByTestId("reading-next")).toHaveCount(0);
});
