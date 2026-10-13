import { expect, test } from "../playwright-test";
import { type Page } from "@playwright/test";

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
/** Подменный `<audio>`: запоминает адрес и скорость каждой записи и «доигрывает» её через миг. */
/** `hold` — запись не кончается, пока тест не вызовет `__next()`: видно, какое предложение звучит. */
async function recordings(page: Page, hold = false) {
  await page.addInitScript((hold) => {
    const played: { src: string; rate: number }[] = [];
    (window as unknown as { __played: typeof played }).__played = played;
    class FakeAudio extends EventTarget {
      src = "";
      playbackRate = 1;
      defaultPlaybackRate = 1;
      duration = 1;
      load() {}
      pause() {}
      play() {
        played.push({ src: this.src, rate: this.playbackRate });
        const end = () => this.dispatchEvent(new Event("ended"));
        if (hold) (window as unknown as { __next: () => void }).__next = end;
        else setTimeout(end, 5);
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, "Audio", { value: FakeAudio, configurable: true });
  }, hold);
}
const played = (page: Page) =>
  page.evaluate(() => (window as unknown as { __played: { src: string; rate: number }[] }).__played.splice(0));
const spoken = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __spoken?: string[] }).__spoken ?? []).splice(0));
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

test("полка «Чтение»: текст открывается после урока, звучит записями предложений, отметку можно снять", async ({
  page,
}) => {
  await voice(page);
  await recordings(page);
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
  // Каждое предложение звучит своей записью: в обычном темпе, затем медленнее; синтез не нужен.
  await page.getByRole("button", { name: "Слушать" }).click();
  let files: { src: string; rate: number }[] = [];
  await expect.poll(async () => (files = files.concat(await played(page))).length).toBe(10);
  expect(files.every((file) => file.rate === 1)).toBe(true);
  await expect(page.getByRole("button", { name: "Слушать" })).toBeVisible();
  await page.getByRole("button", { name: "Обычная скорость" }).click();
  await page.getByRole("button", { name: "Слушать" }).click();
  files = [];
  await expect.poll(async () => (files = files.concat(await played(page))).length).toBe(10);
  expect(files.every((file) => file.rate === 0.8)).toBe(true);
  expect(await spoken(page)).toEqual([]);
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

test("предложение без записи звучит синтезом, остальные — файлами", async ({ page }) => {
  await voice(page);
  await recordings(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  // Контрольная скачивается после урока: отметка ставится, когда её пакет уже на устройстве.
  await page.goto("/app/course/m01");
  await expect(page.getByRole("list", { name: "Чтение" }).getByRole("listitem")).toHaveCount(2);
  await complete(page, "m01-test");
  await page.goto("/app/course/m01/read/r-m01-lemesos");
  await expect(page.getByRole("heading", { name: "Η Άννα στη Λεμεσό", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Слушать" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken))
    .toEqual(["Γεια σας!"]);
  expect((await played(page)).map((file) => file.rate)).toEqual([1, 1, 1, 1]);
});

test("звучащее предложение подсвечено в тексте; после остановки подсветки нет", async ({ page }) => {
  await voice(page);
  await recordings(page, true);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await complete(page, "m01-1");
  await page.goto("/app/course/m01/read/r-m01-anna");
  await expect(page.getByTestId("speaking")).toHaveCount(0);
  await page.getByRole("button", { name: "Слушать" }).click();
  await expect(page.getByTestId("speaking")).toHaveText("Γεια!");
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { __next?: unknown }).__next))
    .toBe("function");
  await page.evaluate(() => (window as unknown as { __next: () => void }).__next());
  await expect(page.getByTestId("speaking")).toHaveText("Καλημέρα!");
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(page.getByTestId("speaking")).toHaveCount(0);
});
