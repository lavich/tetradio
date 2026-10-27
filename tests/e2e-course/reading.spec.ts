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
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, completed: true });
      else tx.abort();
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error(`урок ${lessonId} ещё не установлен`));
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
  await expect(page.getByText("скачивается…")).toHaveCount(0);
  await page.goto("/app/");
  await expect(page.getByTestId("today-title")).toBeAttached();
  await expect(page.getByTestId("reading-sheet")).toBeVisible();

  await complete(page, "m01-1");
  await page.goto("/app/");
  await expect(page.getByTestId("reading-today")).toHaveText("Η Άννα · 28 слов");
  await page.getByRole("link", { name: "Читать" }).click();

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
  await expect(page.getByTestId("reading-today")).toHaveCount(0);
});

test("предложение без записи звучит синтезом, остальные — файлами", async ({ page }) => {
  await voice(page);
  await recordings(page);
  await startCourse(page);
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
  await startCourse(page);
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

test("глагол в тексте для чтения: в подсказке метка неправильного прошедшего, страница не шире экрана", async ({
  page,
}) => {
  await voice(page);
  await recordings(page);
  await startCourse(page);
  await complete(page, "m01-1");
  await page.goto("/app/course/m01/read/r-m01-anna");
  await page.getByRole("button", { name: "Произнести и перевести: Είσαι", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "είμαι" });
  await expect(sheet.getByTestId("verb-group").locator("[aria-hidden]")).toHaveText("неправ. прош.");
  await expect(sheet.getByTestId("verb-group")).toContainText("неправильное прошедшее");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

/** Все карточки пройденных уроков введены и отложены: плана на сегодня нет. */
async function introduceAllCards() {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("tetradio-mock-1");
    request.onsuccess = () => resolve(request.result);
  });
  const read = <T>(store: string) =>
    new Promise<T[]>((resolve) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
    });
  const items = await read<{ unitKey: string; ref: unknown }>("lessonItems");
  const future = new Date("2099-01-01T00:00:00Z");
  const tx = db.transaction("cardStates", "readwrite");
  for (const item of items)
    tx.objectStore("cardStates").put({
      unitKey: item.unitKey,
      ref: item.ref,
      introducedAt: new Date().toISOString(),
      version: 1,
      card: {
        due: future,
        stability: 100,
        difficulty: 5,
        elapsed_days: 0,
        scheduled_days: 100,
        reps: 1,
        lapses: 0,
        state: 2,
        last_review: new Date(),
      },
    });
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
  });
  db.close();
}
async function removePackage(id: string) {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("tetradio-mock-1");
    request.onsuccess = () => resolve(request.result);
  });
  const tx = db.transaction("packages", "readwrite");
  tx.objectStore("packages").delete(id);
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
  });
  db.close();
}
const sheet = (page: Page) => page.getByTestId("reading-sheet");
const primary = (page: Page) => sheet(page).getByRole("link", { name: "Читать" });
async function startCourse(page: Page) {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await page.goto("/app/course/m01");
  await expect(page.getByRole("list", { name: "Чтение" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("скачивается…")).toHaveCount(0);
}
const markReadOnToday = async (page: Page, id: string) => {
  await page.goto(`/app/course/m01/read/${id}`);
  await page.getByRole("button", { name: "Прочитано" }).click();
  await expect(page.getByTestId("reading-done")).toBeVisible();
};

test("«Сегодня»: лист «Чтение» — след, долг, прочитано, снятая отметка", async ({ page }) => {
  await startCourse(page);
  await page.goto("/app/");
  await expect(sheet(page)).toContainText("Следующий текст откроется после урока «Знакомство и είμαι»");
  await expect(sheet(page).getByRole("link")).toHaveCount(0);

  await complete(page, "m01-1");
  await page.goto("/app/");
  await expect(sheet(page).getByRole("img", { name: "непрочитанных текстов: 1" })).toBeVisible();
  await expect(page.getByTestId("reading-today")).toHaveText("Η Άννα · 28 слов");
  await primary(page).click();
  await expect(page.getByRole("heading", { name: "Η Άννα", level: 1 })).toBeVisible();

  await markReadOnToday(page, "r-m01-anna");
  await page.goto("/app/");
  await expect(sheet(page)).toContainText("Прочитано 1 текст");
  await expect(sheet(page)).toContainText("Следующий текст откроется после урока «Контрольная модуля 01»");
  await expect(sheet(page).getByRole("link")).toHaveCount(0);
  await expect(primary(page)).toHaveCount(0);

  await complete(page, "m01-test");
  await page.goto("/app/");
  await expect(sheet(page).getByRole("img", { name: "непрочитанных текстов: 1" })).toBeVisible();
  await markReadOnToday(page, "r-m01-lemesos");
  await page.goto("/app/");
  await expect(sheet(page)).toContainText("Прочитано 2 текста");
  await expect(sheet(page)).not.toContainText("откроется");

  await page.goto("/app/course/m01/read/r-m01-lemesos");
  await page.getByRole("button", { name: "Снять отметку" }).click();
  await expect(page.getByRole("button", { name: "Прочитано" })).toBeVisible();
  await page.goto("/app/");
  await expect(sheet(page).getByRole("img", { name: "непрочитанных текстов: 1" })).toBeVisible();
  await expect(page.getByTestId("reading-today")).toHaveText(/^Η Άννα στη Λεμεσό · \d+ сло/);
});

test("«Сегодня»: «Читать» вторичная, пока есть карточки или урок; на «Сегодня» нет строки экзамена", async ({
  page,
}) => {
  await startCourse(page);
  await complete(page, "m01-1");
  await page.goto("/app/");
  await expect(page.getByTestId("cards-today")).toBeVisible();
  await expect(primary(page)).toHaveAttribute("data-primary", "false");
  const border = await primary(page).evaluate((node) => getComputedStyle(node).borderTopColor);
  const ink = await primary(page).evaluate((node) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--primary)";
    node.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(border).toBe(ink);
  await expect(page.getByTestId("exam-line")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Повторить карточки" })).toBeVisible();

  await page.evaluate(introduceAllCards);
  await page.goto("/app/");
  await expect(page.getByTestId("cards-today")).toHaveCount(0);
  await expect(page.getByTestId("course-next")).toBeVisible();
  await expect(primary(page)).toHaveAttribute("data-primary", "false");
});

test("«Сегодня»: когда всё пройдено и повторено, «Читать» главная рядом с текстом о пройденном курсе", async ({
  page,
}) => {
  await startCourse(page);
  for (const id of ["m01-1", "m01-test", "m01-k1", "m01-r1"]) await complete(page, id);
  await page.evaluate(introduceAllCards);
  await page.goto("/app/");
  await expect(page.getByTestId("course-finished")).toBeVisible();
  await expect(primary(page)).toHaveAttribute("data-primary", "true");
  await expect(page.getByTestId("course-next")).toHaveCount(0);
});

test("«Сегодня»: порядок — повторение, чтение, следующий урок; лист доступен и достаточно крупный", async ({
  page,
}) => {
  await startCourse(page);
  await complete(page, "m01-1");
  await page.goto("/app/");
  const top = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
  expect(await top("cards-today")).toBeLessThan(await top("reading-sheet"));
  expect(await top("reading-sheet")).toBeLessThan(await top("course-next"));
  await expect(page.getByRole("region", { name: "Чтение" })).toBeVisible();
  await expect(page.getByText("Все тексты")).toHaveCount(0);
  expect((await primary(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("«Сегодня»: пока пакет пройденного урока не скачан, листа «Чтение» нет", async ({ page }) => {
  await startCourse(page);
  await page.route("**/content/packages/**", (route) => route.abort());
  await page.evaluate(removePackage, "m01-1");
  await complete(page, "m01-1");
  await page.goto("/app/");
  await expect(page.getByTestId("today-title")).toBeAttached();
  await expect(sheet(page)).toHaveCount(0);
  await page.unroute("**/content/packages/**");
  await page.goto("/app/course/m01");
  await expect(page.getByRole("list", { name: "Чтение" }).getByRole("listitem")).toHaveCount(2);
  await page.goto("/app/");
  await expect(page.getByTestId("reading-today")).toHaveText("Η Άννα · 28 слов");
});

const nav = (page: Page) => page.getByRole("navigation", { name: "Основные разделы" });

test("раздел «Чтение»: состояния списка по ходу прохождения", async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  await page.goto("/app/reading");
  await expect(page.getByRole("heading", { name: "Чтение", level: 1 })).toBeVisible();
  await expect(page.getByText("Ещё 2 текста откроются после уроков.")).toBeVisible();
  await expect(page.getByText("Тексты откроются после первых уроков.")).toHaveCount(0);
  await expect(page.getByTestId("reading-summary")).toHaveCount(0);

  await page.goto("/app/course/m01");
  await expect(page.getByRole("list", { name: "Чтение" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("скачивается…")).toHaveCount(0);
  await complete(page, "m01-1");
  await page.goto("/app/reading");
  await expect(page.getByRole("heading", { name: "Модуль 1", level: 2 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Η Άννα/ })).toBeVisible();
  await expect(page.getByTestId("reading-summary")).toHaveText("Прочитано 0 из 1 открытых");
  await expect(page.getByText("Ещё 1 текст откроется после урока.")).toBeVisible();

  await markReadOnToday(page, "r-m01-anna");
  await page.goto("/app/reading");
  await expect(page.getByTestId("reading-summary")).toHaveText("Прочитано 1 из 1 открытых");
  await expect(page.getByText(/^прочитано /)).toBeVisible();

  await complete(page, "m01-test");
  await page.goto("/app/reading");
  const rows = page.getByRole("list").getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Η Άννα στη Λεμεσό");
  await expect(rows.last()).toContainText("прочитано");
  await expect(page.getByTestId("reading-summary")).toHaveText("Прочитано 1 из 2 открытых");

  for (const id of ["m01-k1", "m01-r1"]) await complete(page, id);
  await expect(page.getByText(/откроется? после/)).toHaveCount(0);
  await expect(page.getByText(/Ещё \d+ текст/)).toHaveCount(0);
});

test("раздел «Чтение»: вкладка выделена, из текста «К списку текстов» возвращает в список", async ({ page }) => {
  await startCourse(page);
  await complete(page, "m01-1");
  await complete(page, "m01-test");
  await page.goto("/app/reading");
  await expect(nav(page).getByRole("link", { name: "Чтение" })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("link", { name: "Курс" })).not.toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("link")).toHaveText(["Сегодня", "Курс", "Слова", "Чтение", "Прогресс"]);

  await page
    .getByRole("link", { name: /Η Άννα/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Η Άννα", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Прочитано" }).click();
  await expect(page.getByRole("button", { name: "К модулю" })).toHaveCount(0);
  await page.getByRole("button", { name: "Следующий текст" }).click();
  await expect(page.getByRole("heading", { name: "Η Άννα στη Λεμεσό", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Прочитано" }).click();
  await page.getByRole("button", { name: "К списку текстов" }).click();
  await expect(page).toHaveURL(/\/app\/reading$/);
  await expect(page.getByTestId("reading-summary")).toHaveText("Прочитано 2 из 2 открытых");

  await page.goto("/app/course/m01");
  await page.getByRole("list", { name: "Чтение" }).getByRole("link").first().click();
  await page.getByRole("button", { name: "К модулю" }).click();
  await expect(page).toHaveURL(/\/app\/course\/m01$/);
});

test("вкладка «Чтение» открывает раздел, «Назад» из текста — обратно в список", async ({ page }) => {
  await startCourse(page);
  await complete(page, "m01-1");
  await page.goto("/app/");
  await nav(page).getByRole("link", { name: "Чтение" }).click();
  await expect(page).toHaveURL(/\/app\/reading$/);
  await page.getByRole("link", { name: /Η Άννα/ }).click();
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page).toHaveURL(/\/app\/reading$/);
});

test("нижнее меню: пять вкладок помещаются в окно 360 px, а в 320 px подписи целы", async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toBeVisible();
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 640 });
    const links = nav(page).getByRole("link");
    await expect(links).toHaveCount(5);
    const cloud = (await nav(page).boundingBox())!;
    expect(cloud.x).toBeGreaterThanOrEqual(width === 360 ? 16 - 0.5 : 0);
    expect(cloud.x + cloud.width).toBeLessThanOrEqual(width - (width === 360 ? 16 : 0) + 0.5);
    for (const link of await links.all()) {
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const label = link.locator("span");
      expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth + 0.5)).toBe(true);
      expect(await label.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(20);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/app/progress");
  const active = nav(page).getByRole("link", { name: "Прогресс" });
  await expect(active).toHaveAttribute("aria-current", "page");
  const label = active.locator("span");
  expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth + 0.5)).toBe(true);
  expect((await active.boundingBox())!.width).toBeGreaterThanOrEqual(44);
});

/** Пройденный урок листается к итогу: каждый шаг ждёт смены «стр. N из M», а не времени. */
async function openSummary(page: Page, lessonId: string) {
  await page.goto(`/app/course/m01/${lessonId}`);
  const stamp = page.getByRole("heading", { name: "Урок пройден" });
  const counter = page.getByTestId("page-count");
  const forward = page
    .getByRole("navigation", { name: "Страницы урока" })
    .getByRole("button", { name: /Далее|К итогу/ });
  await expect(counter).toContainText("стр.");
  for (let turns = 0; turns < 20 && !(await stamp.isVisible()); turns++) {
    const before = await counter.textContent();
    await forward.click();
    await expect(counter).not.toHaveText(before!);
  }
  await expect(stamp).toBeVisible();
}
const finishCourse = async (page: Page) => {
  for (const id of ["m01-1", "m01-test", "m01-k1", "m01-r1"]) await complete(page, id);
};

test("итог урока: пока у курса есть следующий шаг, кнопки «Читать» нет", async ({ page }) => {
  await startCourse(page);
  await complete(page, "m01-1");
  await openSummary(page, "m01-1");
  await expect(page.getByRole("button", { name: /Следующий урок/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Читать/ })).toHaveCount(0);
});

test("итог последнего занятия: «Читать» ведёт к первому непрочитанному тексту, «Назад» возвращает на итог", async ({
  page,
}) => {
  await startCourse(page);
  await finishCourse(page);
  await openSummary(page, "m01-r1");
  const summary = page.url();
  const read = page.getByRole("button", { name: "Читать: Η Άννα" });
  await expect(read).toBeVisible();
  await expect(page.getByRole("button", { name: /Следующий урок/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "К модулю" })).toBeVisible();
  expect(page.url()).toBe(summary);
  await read.click();
  await expect(page.getByRole("heading", { name: "Η Άννα", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page).toHaveURL(summary);
  await expect(page.getByRole("button", { name: "Читать: Η Άννα" })).toBeVisible();
});

test("итог первого урока в законченном курсе тоже предлагает «Читать»", async ({ page }) => {
  await startCourse(page);
  await finishCourse(page);
  await openSummary(page, "m01-1");
  await expect(page.getByRole("button", { name: "Читать: Η Άννα" })).toBeVisible();
});

test("итог последнего занятия без непрочитанных текстов — только «К модулю»", async ({ page }) => {
  await startCourse(page);
  await finishCourse(page);
  await markReadOnToday(page, "r-m01-anna");
  await markReadOnToday(page, "r-m01-lemesos");
  await openSummary(page, "m01-r1");
  await expect(page.getByRole("button", { name: "К модулю" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Читать/ })).toHaveCount(0);
});

test("«Сегодня»: лист «Чтение» не вставляется позже остальной страницы", async ({ page }) => {
  await startCourse(page);
  await complete(page, "m01-1");
  await page.goto("/app/");
  await expect(page.getByTestId("today-title")).toBeAttached();
  expect(await sheet(page).count()).toBe(1);
  expect(await page.locator('[aria-busy="true"]').count()).toBe(0);
});

test("недокачанный урок не прячет открытые тексты: подпись на листе и в разделе", async ({ page }) => {
  await startCourse(page);
  await page.route("**/content/packages/**", (route) => route.abort());
  await page.evaluate(removePackage, "m01-1");
  await complete(page, "m01-1");
  await complete(page, "m01-test");
  await page.goto("/app/");
  await expect(page.getByTestId("reading-today")).toContainText("Η Άννα στη Λεμεσό");
  await expect(sheet(page)).toContainText("Часть текстов ещё скачивается.");
  await expect(sheet(page)).not.toContainText("откроется");
  await page.goto("/app/reading");
  await expect(page.getByTestId("reading-summary")).toHaveText("Прочитано 0 из 1 открытых");
  await expect(page.getByText("Часть текстов ещё скачивается.")).toBeVisible();
  await expect(page.getByText(/Ещё \d+ текст/)).toHaveCount(0);

  await page.evaluate(removePackage, "m01-test");
  await page.goto("/app/reading");
  await expect(page.getByText("Тексты скачиваются.")).toBeVisible();
  await expect(page.getByTestId("reading-summary")).toHaveCount(0);
});
