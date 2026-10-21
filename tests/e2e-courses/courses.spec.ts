import { expect, test } from "../playwright-test";
import { type Page } from "@playwright/test";
import { PALETTES } from "../../src/content/palettes";

const GREEK_WORDS = ["γεια", "καλημέρα", "είμαι", "από", "η χώρα"];
const ENGLISH_WORDS = ["to go", "the bus", "to read", "the coffee", "to write"];

/** Неначатый курс начинается кнопкой на экране модуля, затем модуль ставит свои уроки: сначала греческий, затем английский. */
async function openModule(page: Page, moduleId: string) {
  await page.goto(`/app/course/${moduleId}`);
  const learn = page.getByRole("button", { name: /^Учить курс/ });
  const contents = page.getByRole("heading", { name: "Содержание" });
  await expect(learn.or(contents)).toBeVisible();
  if (await learn.isVisible()) await learn.click();
  await expect(contents).toBeVisible();
  await expect(page.getByText("скачивается…")).toHaveCount(0);
}
async function installBoth(page: Page) {
  await openModule(page, "m01");
  await openModule(page, "e01");
}

const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(", ")})`;
const shelves = (page: Page) => page.getByTestId("course-shelf");
async function chooseLanguage(page: Page, name: string) {
  await page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio", { name, exact: true }).click();
}
async function installEnglishPair(page: Page) {
  await installBoth(page);
  await openModule(page, "c01");
}

/** Урок листается страницами: вперёд, пока нужный блок не окажется на открытой странице. */
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
/** Одно выполненное задание начинает урок: его карточки идут в повторение. */
async function startLesson(page: Page, path: string, exercise: string, option: string) {
  await page.goto(path);
  const block = await turnTo(page, exercise);
  await block.getByRole("group", { name: "Варианты 1" }).getByRole("button", { name: option }).click();
  const second = block.getByRole("group", { name: "Варианты 2" });
  if (await second.count()) await second.getByRole("button").first().click();
  await block.getByRole("button", { name: "Проверить" }).click();
  await expect(block.getByRole("status")).toBeVisible();
}

/** Незавершённое занятие из базы: курс и написания его карточек. */
const activeSession = (page: Page) =>
  page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<
      { status: string; courseId?: string; items: { card: { word?: { greek: string } } }[] }[]
    >((resolve) => {
      const request = database.transaction("sessions").objectStore("sessions").getAll();
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    const active = sessions.filter((session) => session.status === "active");
    return active.map((session) => ({
      courseId: session.courseId,
      words: session.items.flatMap((item) => (item.card.word ? [item.card.word.greek] : [])),
    }));
  });

test("«Сегодня»: основной греческий курс целиком, ниже — строка английского", async ({ page }) => {
  await installBoth(page);
  await page.goto("/app/");
  const next = page.getByTestId("course-next");
  await expect(next).toContainText("Знакомство и είμαι");
  const other = page.getByTestId("other-course");
  await expect(other).toHaveCount(1);
  await expect(other.getByRole("heading", { name: "Английский" })).toBeVisible();
  await expect(other.getByRole("link", { name: /Дорога на работу/ })).toBeVisible();
  await expect(other).toContainText("повторений нет");
  const [main, line] = await Promise.all([next.boundingBox(), other.boundingBox()]);
  expect(line!.y).toBeGreaterThan(main!.y);

  await other.getByRole("link", { name: /Дорога на работу/ }).click();
  await expect(page).toHaveURL(/\/course\/e01\/e01-1\?p=\d+$/);
});

test("длинное название урока второго курса не расширяет «Сегодня» на 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.route("**/content/packages/e01-1*", async (route) => {
    const response = await route.fetch();
    const pack = await response.json();
    pack.lesson.title = "Вежливые просьбы у стойки регистрации в аэропорту";
    await route.fulfill({ response, json: pack });
  });
  await installBoth(page);
  await page.goto("/app/");
  const other = page.getByTestId("other-course");
  await expect(other.getByRole("link", { name: /Вежливые просьбы/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("строки текста для чтения в уроке не сливаются: табло и меню читаются построчно", async ({ page }) => {
  await page.route("**/content/packages/e01-1*", async (route) => {
    const response = await route.fetch();
    const pack = await response.json();
    const reading = pack.blocks.find((block: { type: string }) => block.type === "reading");
    reading.text = reading.text.replace("bus. She", "bus.\nShe");
    await route.fulfill({ response, json: pack });
  });
  await installBoth(page);
  await page.goto("/app/course/e01/e01-1");
  const reading = await turnTo(page, "Чтение: Anna");
  const text = await reading.locator("p", { hasText: "Anna goes" }).evaluate((node) => (node as HTMLElement).innerText);
  expect(text).toContain("bus.\nShe");
});

test("переключатель на «Словах» меняет язык «Слов», «Курса» и «Прогресса» и переживает перезапуск", async ({
  page,
}) => {
  await installBoth(page);
  await page.goto("/app/words");
  const switcher = page.getByRole("radiogroup", { name: "Язык" });
  await switcher.getByRole("radio", { name: "Греческий" }).click();
  await expect(switcher.getByRole("radio", { name: "Греческий" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("γεια", { exact: true })).toBeVisible();
  await expect(page.getByText("the bus", { exact: true })).toHaveCount(0);

  await switcher.getByRole("radio", { name: "Английский" }).click();
  await expect(page.getByText("the bus", { exact: true })).toBeVisible();
  await expect(page.getByText("γεια", { exact: true })).toHaveCount(0);

  await page.getByRole("navigation").getByRole("link", { name: "Курс" }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio", { name: "Английский" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("link", { name: /Модуль 1: Работа/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Знакомство/ })).toHaveCount(0);

  await page.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await expect(page.getByTestId("pace")).toContainText("До A2 (Ступень A2");

  await page.reload();
  await expect(
    page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio", { name: "Английский" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("pace")).toContainText("До A2 (Ступень A2");

  await page.getByRole("radio", { name: "Английский" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "Греческий" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("pace")).toContainText("До K1 (Контрольная A1");
});

test("основным становится английский — «Сегодня» показывает его первым, греческий строкой ниже", async ({ page }) => {
  await installBoth(page);
  await page.goto("/app/progress/settings");
  const choice = page.getByRole("radiogroup", { name: "Основной курс" });
  await expect(choice.getByRole("radio", { name: "Греческий" })).toHaveAttribute("aria-checked", "true");
  await choice.getByRole("radio", { name: "Английский" }).click();
  await expect(choice.getByRole("radio", { name: "Английский" })).toHaveAttribute("aria-checked", "true");
  // Варианты остаются на местах: выбор не переставляет курсы.
  await expect(choice.getByRole("radio")).toHaveText(["Греческий", "Английский"]);

  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Дорога на работу");
  const other = page.getByTestId("other-course");
  await expect(other.getByRole("heading", { name: "Греческий" })).toBeVisible();
  await expect(other.getByRole("link", { name: /Знакомство и είμαι/ })).toBeVisible();
});

test("занятие повторения английского курса — только английские карточки", async ({ page }) => {
  await installBoth(page);
  await startLesson(page, "/app/course/m01/m01-1", "Формы είμαι", "είμαι");
  await startLesson(page, "/app/course/e01/e01-1", "Верно или неверно?", "False");

  await page.goto("/app/");
  await expect(page.getByTestId("cards-today")).toBeVisible();
  const other = page.getByTestId("other-course");
  const review = other.getByRole("button", { name: "Повторить 5" });
  await expect(review).toBeVisible();
  await review.click();
  await expect(page).toHaveURL(/\/session\?course=english$/);
  await expect(page.getByRole("heading", { name: "Повторение", level: 1 })).toBeVisible();
  const [english] = await activeSession(page);
  expect(english.courseId).toBe("english");
  expect(english.words.length).toBeGreaterThan(0);
  expect(english.words.every((word) => ENGLISH_WORDS.includes(word))).toBe(true);

  // Незаконченное английское занятие не подменяет греческое: «Повторить карточки» собирает своё.
  await page.goto("/app/");
  await expect(other.getByRole("button", { name: "Продолжить" })).toBeVisible();
  await page.getByRole("button", { name: "Повторить карточки" }).click();
  await expect(page.getByRole("heading", { name: "Повторение", level: 1 })).toBeVisible();
  const greek = (await activeSession(page)).find((session) => session.courseId === "greek-a2")!;
  expect(greek.words.length).toBeGreaterThan(0);
  expect(greek.words.every((word) => GREEK_WORDS.includes(word))).toBe(true);
});

test("один начатый курс — без переключателя и строки второго курса; на «Курсе» — неначатый английский", async ({
  page,
}) => {
  await openModule(page, "m01");
  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toBeVisible();
  await expect(page.getByTestId("other-course")).toHaveCount(0);
  for (const path of ["/app/words", "/app/reading", "/app/progress"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Язык" })).toHaveCount(0);
  }
  await page.goto("/app/course");
  await expect(page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio")).toHaveText([
    "Греческий",
    "+ Английский",
  ]);
  await expect(page.getByRole("radio", { name: "Английский, не начат" })).toBeVisible();
  await page.goto("/app/progress/settings");
  await expect(page.getByRole("heading", { name: "Занятия" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Основной курс" })).toHaveCount(0);
});

/** Урок пройден записью в базу: проверяется «Сегодня», а не урок. */
const completeLesson = (page: Page, lessonId: string) =>
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

test("«Все тексты» открывает раздел основного курса, даже если выбран другой; у английского тексты закрыты", async ({
  page,
}) => {
  await installBoth(page);
  await completeLesson(page, "m01-1");
  await page.goto("/app/words");
  await page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio", { name: "Английский" }).click();
  await expect(page.getByText("the bus", { exact: true })).toBeVisible();

  await page.goto("/app/");
  await page.getByTestId("reading-all").click();
  await expect(page).toHaveURL(/\/app\/reading$/);
  await expect(
    page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio", { name: "Греческий" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("link", { name: /Η Άννα/ })).toBeVisible();

  await page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio", { name: "Английский" }).click();
  await expect(page.getByText("Ещё 1 текст откроется после урока.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Η Άννα/ })).toHaveCount(0);
});

test("лист «Чтение» только у основного курса: у строки второго курса его нет, у английского основного — свой", async ({
  page,
}) => {
  await installBoth(page);
  await completeLesson(page, "m01-1");
  await page.goto("/app/");
  await expect(page.getByTestId("reading-today")).toHaveText("Η Άννα · 28 слов");
  await expect(page.getByTestId("reading-sheet")).toHaveCount(1);
  await expect(page.getByTestId("other-course").getByTestId("reading-sheet")).toHaveCount(0);

  await page.goto("/app/progress/settings");
  const choice = page.getByRole("radiogroup", { name: "Основной курс" });
  await choice.getByRole("radio", { name: "Английский" }).click();
  await expect(choice.getByRole("radio", { name: "Английский" })).toHaveAttribute("aria-checked", "true");
  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Дорога на работу");
  await expect(page.getByTestId("reading-sheet")).toHaveCount(1);
  await expect(page.getByTestId("reading-sheet")).toContainText(
    "Следующий текст откроется после урока «Дорога на работу»",
  );
  await expect(page.getByTestId("other-course").getByTestId("reading-sheet")).toHaveCount(0);
});

/** Записи хранилища из базы приложения: проверяется то, что записано, а не то, что видно. */
const rows = <T>(page: Page, store: string, key?: string) =>
  page.evaluate(
    async ({ store, key }) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("tetradio-mock-1");
        request.onsuccess = () => resolve(request.result);
      });
      const result = await new Promise<unknown>((resolve) => {
        const objects = database.transaction(store).objectStore(store);
        const request = key === undefined ? objects.getAll() : objects.get(key);
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      return result;
    },
    { store, key },
  ) as Promise<T>;
const savedLanguage = async (page: Page) =>
  (await rows<{ value?: string } | undefined>(page, "meta", "currentLanguage"))?.value;
const lessonsOf = async (page: Page, courseId: string) =>
  (await rows<{ courseId?: string }[]>(page, "lessons")).filter((lesson) => lesson.courseId === courseId).length;

/** Пакеты курса ждут, пока тест не отпустит их: состояние «загружается» видно без гонки. */
async function holdPackages(page: Page, prefix: string) {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/content/packages/${prefix}*`, async (route) => {
    await released;
    await route.continue();
  });
  return release;
}
/** Запросы пакетов курса: адрес модуля или урока неначатого курса не должен их делать. */
async function watchPackages(page: Page, prefix: string) {
  const asked: string[] = [];
  await page.route(`**/content/packages/${prefix}*`, async (route) => {
    asked.push(route.request().url());
    await route.continue();
  });
  return asked;
}

test("второй курс с полки: карточка неначатого курса, «Учить курс», затем его обложки", async ({ page }) => {
  await openModule(page, "m01");
  await page.goto("/app/course");
  const switcher = page.getByRole("radiogroup", { name: "Язык" });
  await expect(switcher.getByRole("radio", { name: "Греческий" })).toHaveAttribute("aria-checked", "true");
  await page.goto("/app/words");
  await expect(page.getByRole("radiogroup", { name: "Язык" })).toHaveCount(0);

  await page.goto("/app/course");
  await switcher.getByRole("radio", { name: "Английский, не начат" }).click();
  await expect(page.getByTestId("course-offer")).toHaveCount(2);
  const offer = page.getByTestId("course-offer").first();
  await expect(offer.getByRole("heading", { level: 2, name: "Английский · B1 → B2" })).toBeVisible();
  await expect(offer.getByTestId("first-course")).toHaveText("Английский · B1 → B21 модуль");
  await expect(page.getByRole("link", { name: /Модуль 1: Знакомство/ })).toHaveCount(0);

  const release = await holdPackages(page, "e01-");
  await offer.getByRole("button", { name: "Учить курс «Английский»" }).click();
  const loading = offer.getByRole("button", { name: "Загружаем курс «Английский»…" });
  await expect(loading).toHaveText("Загружаем курс…");
  await expect(loading).toBeFocused();
  await expect(offer.getByRole("status")).toHaveText("Загружаем курс «Английский»");
  release();
  await expect(page.getByRole("link", { name: /Модуль 1: Работа/ })).toBeVisible();
  await expect(switcher.getByRole("radio", { name: "Английский" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("course-offer").getByRole("heading")).toHaveText("Английский для общения · B1");
  const shelfBottom = await shelves(page)
    .last()
    .evaluate((node) => node.getBoundingClientRect().bottom);
  const offerTop = await page.getByTestId("course-offer").evaluate((node) => node.getBoundingClientRect().top);
  expect(offerTop - shelfBottom).toBeGreaterThanOrEqual(36);

  await page.goto("/app/words");
  const words = page.getByRole("radiogroup", { name: "Язык" });
  await expect(words.getByRole("radio")).toHaveText(["Греческий", "Английский"]);
  await expect(words.getByRole("radio", { name: "Английский" })).toHaveAttribute("aria-checked", "true");

  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
  await expect(page.getByTestId("other-course").getByRole("heading", { name: "Английский" })).toBeVisible();
});

test("ссылка на модуль начатого курса возвращает «Курс» к его языку", async ({ page }) => {
  await openModule(page, "m01");
  await page.goto("/app/course");
  await page.getByRole("radio", { name: "Английский, не начат" }).click();
  await expect(page.getByTestId("course-offer")).toHaveCount(2);
  await page.goto("/app/");
  await page.getByTestId("course-next").click();
  await expect(page).toHaveURL(/\/course\/m01\//);
  await expect.poll(() => savedLanguage(page)).toBe("el");
  await page.goto("/app/course");
  await expect(page.getByRole("radio", { name: "Греческий" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("link", { name: /Модуль 1: Знакомство/ })).toBeVisible();
});

test("стартовый экран: курсы по языкам по месту, «Готовится» без кнопки, курсы начинаются по одному", async ({
  page,
}) => {
  await page.goto("/app/course");
  await expect(page.getByTestId("course-offer")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Греческий · A0 → A2" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Модуль 1:/ })).toHaveCount(0);

  await page.goto("/app/");
  await expect(page.getByTestId("today-title")).toHaveText("Выберите курс");
  await expect(page.getByText("🇬🇷")).toHaveCount(0);
  await expect(page.getByText("τετράδιο", { exact: true })).toHaveAttribute("lang", "el");
  await expect(page.getByText("Курсы языков с уроками по программе и ежедневным повторением карточек")).toBeVisible();
  await expect(page.getByText("Уроки загрузятся на устройство и будут доступны без сети.")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Греческий · A0 → A2", "Английский"]);
  const offers = page.getByTestId("course-offer");
  await expect(offers.nth(0).getByTestId("first-course")).toHaveText(
    "Греческий · A0 → A2С нуля до экзамена ΚΕΓ A2Готов 1 модуль из 2",
  );
  await expect(offers.nth(0).locator('[lang="el"]')).toHaveText("ΚΕΓ");
  await expect(page.getByText(/в неделю/)).toHaveCount(0);
  const english = page.getByTestId("courses-en").getByTestId("course-offer");
  await expect(english.getByRole("heading", { level: 3 })).toHaveText([
    "Английский · B1 → B2",
    "Английский для путешествий · B1 → B1+",
    "Английский для общения · B1",
  ]);
  await expect(english.nth(0).getByTestId("first-course")).toHaveText("Английский · B1 → B21 модуль");
  const learnEnglish = english.nth(0).getByRole("button", { name: "Учить курс «Английский»" });
  await expect(learnEnglish).not.toHaveAttribute("aria-disabled");
  await expect(english.nth(1).getByTestId("course-preparing")).toHaveText("Готовится");
  await expect(english.nth(1).getByRole("button")).toHaveCount(0);

  const release = await holdPackages(page, "m01-");
  await offers.nth(0).getByRole("button", { name: "Учить курс «Греческий»" }).click();
  await expect(learnEnglish).toHaveAttribute("aria-disabled", "true");
  await expect(learnEnglish).toHaveAccessibleDescription("Сначала загрузится «Греческий»");
  await learnEnglish.click({ force: true });
  expect(await lessonsOf(page, "english")).toBe(0);
  release();
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
});

test("адрес модуля и урока неначатого курса — карточка курса, пакеты не запрашиваются до нажатия", async ({ page }) => {
  await openModule(page, "m01");
  const asked = await watchPackages(page, "e01-");
  await page.goto("/app/course/e01");
  await expect(page.getByRole("button", { name: "Учить курс «Английский»" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Содержание" })).toHaveCount(0);
  await page.goto("/app/course/e01/e01-1");
  await expect(page.getByRole("button", { name: "Учить курс «Английский»" })).toBeVisible();
  await expect(page.getByText("Урок скачивается…")).toHaveCount(0);
  expect(asked).toEqual([]);
  expect(await lessonsOf(page, "english")).toBe(0);
});

test("курс, начатый на другом устройстве и не скачанный, — без «+», модуль докачивает уроки", async ({ page }) => {
  await openModule(page, "m01");
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const pending = { "e01-1": { id: "e01-1", completed: true, updatedAt: "2026-10-01T09:00:00.000Z" } };
    const tx = database.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key: "sync:pendingLessons", value: JSON.stringify(pending) });
    await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()));
    database.close();
  });
  await page.goto("/app/course");
  await expect(page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio")).toHaveText([
    "Греческий",
    "Английский",
  ]);
  await page.goto("/app/course/e01");
  await expect(page.getByRole("heading", { name: "Содержание" })).toBeVisible();
  await expect.poll(() => lessonsOf(page, "english")).toBeGreaterThan(0);
});

test("переключатель языков при четырёх курсах на 360 px — два языка целиком, лента не прокручивается", async ({
  page,
}) => {
  await page.route("**/content/catalog.json", async (route) => {
    const catalog = await (await route.fetch()).json();
    const lesson = catalog.lessons.find((entry: { id: string }) => entry.id === "e01-1");
    catalog.courses.push({
      id: "english-2",
      title: "Английский 2",
      language: "en",
      short: "Английский 2",
      order: 5,
      lessonIds: ["e02-copy"],
    });
    catalog.lessons.push({ ...lesson, id: "e02-copy", courseId: "english-2" });
    await route.fulfill({ json: catalog });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await openModule(page, "m01");
  await page.goto("/app/course");
  const switcher = page.getByRole("radiogroup", { name: "Язык" });
  const radios = switcher.getByRole("radio");
  await expect(radios).toHaveText(["Греческий", "+ Английский"]);
  const clipped = await radios.evaluateAll(
    (items) => items.filter((item) => item.scrollWidth > item.clientWidth + 1).length,
  );
  expect(clipped).toBe(0);
  expect(await switcher.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await radios.nth(1).click();
  await expect(page.getByTestId("course-offer").getByRole("heading", { level: 2 })).toHaveText([
    "Английский · B1 → B2",
    "Английский для общения · B1",
    "Английский 2",
  ]);
});

async function toggleFromShelf(
  page: Page,
  language: string,
  shelf: string,
  title: string,
  action: "Приостановить курс" | "Продолжить курс",
) {
  await page.goto("/app/course");
  const switcher = page.getByRole("radiogroup", { name: "Язык" });
  if (await switcher.count()) await switcher.getByRole("radio", { name: language, exact: true }).click();
  const own = shelves(page).filter({ has: page.getByRole("heading", { level: 2, name: shelf }) });
  await own.getByRole("button", { name: `Действия с курсом «${title}»`, exact: true }).click();
  await page.getByRole("menuitem", { name: action }).click();
  const paused = own.getByTestId("shelf-paused");
  if (action === "Приостановить курс") await expect(paused).toBeVisible();
  else await expect(paused).toHaveCount(0);
}
const overdueEnglish = (page: Page, count: number, dueDays: number) =>
  page.evaluate(
    async ({ count, dueDays }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("tetradio-mock-1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const items = await new Promise<{ lessonId: string; unitKey: string; ref: unknown }[]>((resolve) => {
        const request = database.transaction("lessonItems").objectStore("lessonItems").getAll();
        request.onsuccess = () => resolve(request.result);
      });
      const own = items.filter((item) => item.lessonId.startsWith("e01")).slice(0, count);
      const day = 86400000;
      const write = database.transaction("cardStates", "readwrite");
      for (const item of own)
        write.objectStore("cardStates").put({
          unitKey: item.unitKey,
          ref: item.ref,
          card: {
            due: new Date(Date.now() + dueDays * day),
            stability: 3,
            difficulty: 5,
            elapsed_days: 0,
            scheduled_days: 3,
            learning_steps: 0,
            reps: 2,
            lapses: 0,
            state: 2,
            last_review: new Date(Date.now() - 30 * day),
          },
          introducedAt: new Date(Date.now() - 40 * day).toISOString(),
          version: 1,
        });
      await new Promise((resolve) => (write.oncomplete = resolve));
      database.close();
    },
    { count, dueDays },
  );
const contrastOfCovers = (page: Page) =>
  page.evaluate(() => {
    const rgb = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    return [...document.querySelectorAll<HTMLElement>('a[aria-label^="Модуль"]')].map((cover) => ({
      ratio: ratio(rgb(getComputedStyle(cover).color), rgb(getComputedStyle(cover).backgroundColor)),
      filter: getComputedStyle(cover).filter,
    }));
  });

test("пауза с полки убирает английский с «Сегодня», возврат возвращает", async ({ page }) => {
  await installBoth(page);
  await toggleFromShelf(page, "Английский", "Для IT · B1 → B2", "Английский", "Приостановить курс");
  const status = page.getByTestId("shelf-status");
  await expect(status).toHaveText("Курс «Английский» на паузе. Вернуть его можно на полке или в настройках.");
  await expect(status).toHaveClass(/sr-only/);
  const paused = page.getByTestId("shelf-paused");
  await expect(paused).toContainText(/^На паузе с \d+ [а-я]+/);
  await expect(paused.getByRole("button", { name: "Продолжить курс" })).toBeFocused();
  await expect(page.getByRole("link", { name: /Модуль 1: Работа/ })).toBeVisible();
  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
  await expect(page.getByTestId("other-course")).toHaveCount(0);

  await page.goto("/app/course");
  await page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio", { name: "Английский", exact: true }).click();
  await paused.getByRole("button", { name: "Продолжить курс" }).click();
  await expect(paused).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Действия с курсом «Английский»" })).toBeFocused();
  await page.goto("/app/");
  await expect(page.getByTestId("other-course").getByRole("heading", { name: "Английский" })).toBeVisible();
});

test("строка статуса паузы не переходит на полку другого курса", async ({ page }) => {
  await installBoth(page);
  await toggleFromShelf(page, "Английский", "Для IT · B1 → B2", "Английский", "Приостановить курс");
  await expect(page.getByTestId("shelf-status")).toHaveText(/на паузе/);
  await page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio", { name: "Греческий" }).click();
  await expect(page.getByRole("button", { name: "Действия с курсом «Греческий»" })).toBeVisible();
  await expect(page.getByTestId("shelf-status")).toHaveText("");
});

test("основной на паузе из настроек — на «Сегодня» основным становится следующий, после возврата — прежний", async ({
  page,
}) => {
  await installBoth(page);
  await page.goto("/app/progress/settings");
  const courses = page.getByTestId("settings-courses");
  const pause = courses.getByRole("button", { name: "Приостановить курс «Греческий»" });
  await pause.click();
  await expect(page.getByTestId("courses-status")).toHaveText("Курс «Греческий» на паузе.");
  const resume = courses.getByRole("button", { name: "Продолжить курс «Греческий»" });
  await expect(resume).toBeFocused();
  await expect(courses.getByTestId("settings-course").first()).toContainText(/Греческий\s*На паузе с/);
  const choice = page.getByRole("radiogroup", { name: "Основной курс" });
  const greek = choice.getByRole("radio", { name: "Греческий, на паузе" });
  await expect(greek).toHaveAttribute("aria-checked", "true");
  await expect(greek).toHaveAttribute("aria-disabled", "true");
  await greek.dispatchEvent("click");
  await expect(greek).toHaveAttribute("aria-checked", "true");

  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Дорога на работу");
  await expect(page.getByTestId("other-course")).toHaveCount(0);
  await page.goto("/app/words");
  const words = page.getByRole("radiogroup", { name: "Язык" });
  await words.getByRole("radio", { name: "Греческий" }).click();
  await expect(words.getByRole("radio", { name: "Греческий" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("γεια").first()).toBeVisible();

  await page.goto("/app/progress/settings");
  await resume.click();
  await expect(courses.getByRole("button", { name: "Приостановить курс «Греческий»" })).toBeFocused();
  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
});

test("выбор основного из трёх курсов на 360 px — список, все названия целиком, курс на паузе с пометкой", async ({
  page,
}) => {
  await page.route("**/content/catalog.json", async (route) => {
    const catalog = await (await route.fetch()).json();
    const lesson = catalog.lessons.find((entry: { id: string }) => entry.id === "e01-1");
    catalog.courses.push({
      id: "english-2",
      title: "Английский для путешествий и общения",
      language: "en",
      short: "Английский 2",
      order: 5,
      lessonIds: ["e02-copy"],
    });
    catalog.lessons.push({ ...lesson, id: "e02-copy", courseId: "english-2" });
    await route.fulfill({ json: catalog });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await installBoth(page);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("tetradio-mock-1");
      request.onsuccess = () => resolve(request.result);
    });
    const write = database.transaction("meta", "readwrite");
    write.objectStore("meta").put({
      key: "sync:pendingLessons",
      value: JSON.stringify({
        "e02-copy": { id: "e02-copy", completed: true, updatedAt: new Date().toISOString() },
      }),
    });
    await new Promise((resolve) => (write.oncomplete = resolve));
    database.close();
  });
  await page.goto("/app/progress/settings");
  await page.getByRole("button", { name: "Приостановить курс «Английский»" }).click();
  const radios = page.getByRole("radiogroup", { name: "Основной курс" }).getByRole("radio");
  await expect(radios).toHaveText(["Греческий", "Английский · на паузе", "Английский для путешествий и общения"]);
  await expect(radios.nth(1)).toHaveAttribute("aria-disabled", "true");
  for (const radio of await radios.all()) {
    const box = (await radio.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await radio.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("все курсы на паузе — «Все курсы на паузе», «Начать другой курс» открывает карточку неначатого", async ({
  page,
}) => {
  await openModule(page, "m01");
  await toggleFromShelf(page, "Греческий", "Греческий · A0 → A2", "Греческий", "Приостановить курс");
  await page.goto("/app/progress");
  await expect(page.getByTestId("progress-paused")).toContainText(
    /^Курс на паузе с \d+ [а-я]+\. Календарь курса не сдвигается\.$/,
  );
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "Все курсы на паузе" })).toBeVisible();
  await expect(page.getByTestId("paused-course")).toHaveCount(1);
  await expect(page.getByTestId("paused-course")).toContainText("На паузе с");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Все курсы на паузе" })).toBeVisible();
  await page.getByRole("button", { name: "Начать другой курс" }).click();
  await expect(page).toHaveURL(/\/course$/);
  const offer = page.getByTestId("course-offer").filter({ hasText: "Английский · B1 → B2" });
  await expect(offer.getByRole("button", { name: "Учить курс «Английский»" })).toBeVisible();
  await expect(offer).toBeInViewport();
  await expect(offer).toBeFocused();

  await page.goto("/app/");
  await page.getByRole("button", { name: /^Продолжить курс/ }).click();
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
  await expect(page.getByTestId("today-title")).toBeFocused();
});

test("после паузы — полное число и строка «сначала то, что могло забыться», пока долг не повторён", async ({
  page,
}) => {
  await installBoth(page);
  await startLesson(page, "/app/course/e01/e01-1", "Верно или неверно?", "False");
  await overdueEnglish(page, 3, -20);
  await toggleFromShelf(page, "Английский", "Для IT · B1 → B2", "Английский", "Приостановить курс");
  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
  await expect(page.getByTestId("other-course")).toHaveCount(0);
  await toggleFromShelf(page, "Английский", "Для IT · B1 → B2", "Английский", "Продолжить курс");
  await page.goto("/app/");
  const other = page.getByTestId("other-course");
  await expect(other.getByRole("button", { name: "Повторить 5" })).toBeVisible();
  await expect(other.getByTestId("after-pause")).toHaveText("После паузы: сначала то, что могло забыться");
  await overdueEnglish(page, 3, 3);
  await page.reload();
  await expect(other.getByRole("button", { name: "Повторить 2" })).toBeVisible();
  await expect(other.getByTestId("after-pause")).toHaveCount(0);
});

test("меню «⋯»: клавиатура, щелчок вне, Tab, 44 px, полка на паузе на 360 px с читаемыми обложками", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await installBoth(page);
  await page.goto("/app/course");
  await expect(page.getByRole("link", { name: /Модуль 1: Работа/ })).toBeVisible();
  const before = await contrastOfCovers(page);
  expect(before.length).toBeGreaterThan(0);
  const trigger = page.getByRole("button", { name: "Действия с курсом «Английский»" });
  const box = await trigger.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const item = page.getByRole("menuitem", { name: "Приостановить курс" });
  await trigger.click();
  await expect(item).toBeVisible();
  await page.getByRole("heading", { name: "Полка" }).click();
  await expect(item).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(item).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-controls", (await page.getByRole("menu").getAttribute("id"))!);
  await page.keyboard.press("Tab");
  await expect(item).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(item).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const resume = page.getByTestId("shelf-paused").getByRole("button", { name: "Продолжить курс" });
  await expect(resume).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const after = await contrastOfCovers(page);
  for (const [index, cover] of after.entries()) {
    expect(cover.filter).toBe("none");
    expect(cover.ratio).toBeGreaterThanOrEqual(Math.min(4.5, before[index].ratio));
  }
  const text = await page
    .getByTestId("shelf-paused")
    .locator("p")
    .evaluate((node) => {
      const rgb = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const lum = ([r, g, b]: number[]) =>
        [r, g, b]
          .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      let background: Element | null = node;
      while (background && getComputedStyle(background).backgroundColor === "rgba(0, 0, 0, 0)")
        background = background.parentElement;
      const [x, y] = [
        lum(rgb(getComputedStyle(node).color)),
        lum(rgb(getComputedStyle(background ?? document.body).backgroundColor)),
      ].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    });
  expect(text).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
});

test("две полки английского: заголовки, счётчики, свои гаммы, пауза одной полки не трогает другую", async ({
  page,
}) => {
  await installEnglishPair(page);
  await page.goto("/app/course");
  await chooseLanguage(page, "Английский");
  await expect(shelves(page).getByRole("heading", { level: 2 })).toHaveText(["Для IT · B1 → B2", "Для общения · B1"]);
  await expect(shelves(page).nth(0)).toContainText("0 из 1 заполнено");
  await expect(shelves(page).nth(1)).toContainText("0 из 1 заполнено");
  const cover = (index: number) =>
    shelves(page)
      .nth(index)
      .getByRole("link", { name: /^Модуль 1:/ });
  await expect(cover(0)).toHaveCSS("background-color", rgbOf(PALETTES.ink[0]));
  await expect(cover(1)).toHaveCSS("background-color", rgbOf(PALETTES.coast[0]));

  await page.getByRole("button", { name: "Действия с курсом «Английский для общения»" }).click();
  await page.getByRole("menuitem", { name: "Приостановить курс" }).click();
  await expect(shelves(page).nth(1).getByTestId("shelf-paused")).toContainText(/^На паузе с \d+ [а-я]+/);
  await expect(shelves(page).nth(0).getByTestId("shelf-paused")).toHaveCount(0);
  await expect(page.getByTestId("shelf-status")).toHaveText(
    "Курс «Английский для общения» на паузе. Вернуть его можно на полке или в настройках.",
  );
  await expect(cover(0)).toHaveCSS("background-color", rgbOf(PALETTES.ink[0]));
  await expect(page.getByRole("button", { name: "Действия с курсом «Английский»" })).toBeVisible();
});

test("неначатый курс языка — карточка под полкой, «Учить курс» превращает её в полку", async ({ page }) => {
  await installBoth(page);
  await page.goto("/app/course");
  await chooseLanguage(page, "Английский");
  await expect(shelves(page)).toHaveCount(1);
  const offer = page.getByTestId("course-offer");
  await expect(offer.getByRole("heading", { level: 2 })).toHaveText("Английский для общения · B1");
  await expect(offer.getByRole("link")).toHaveCount(0);
  const [shelf, card] = await Promise.all([shelves(page).boundingBox(), offer.boundingBox()]);
  expect(card!.y).toBeGreaterThan(shelf!.y + shelf!.height - 1);
  await offer.getByRole("button", { name: "Учить курс «Английский для общения»" }).click();
  await expect(shelves(page).getByRole("heading", { level: 2 })).toHaveText(["Для IT · B1 → B2", "Для общения · B1"]);
  await expect(page.getByTestId("course-offer")).toHaveCount(0);
});

test("+ Английский — карточки курсов, без полок; пока ставится первый, «Учить курс» у второго недоступна", async ({
  page,
}) => {
  await openModule(page, "m01");
  await page.goto("/app/course");
  await page.getByRole("radiogroup", { name: "Язык" }).getByRole("radio", { name: "Английский, не начат" }).click();
  const offers = page.getByTestId("course-offer");
  await expect(offers.getByRole("heading", { level: 2 })).toHaveText([
    "Английский · B1 → B2",
    "Английский для общения · B1",
  ]);
  await expect(shelves(page)).toHaveCount(0);
  const first = offers.nth(0).getByRole("button", { name: "Учить курс «Английский»" });
  const second = offers.nth(1).getByRole("button", { name: "Учить курс «Английский для общения»" });
  const background = (button: typeof first) => button.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(await background(first)).not.toBe(await background(second));
  const release = await holdPackages(page, "e01-");
  await first.click();
  await expect(second).toHaveAttribute("aria-disabled", "true");
  await expect(second).toHaveAccessibleDescription("Сначала загрузится «Английский»");
  release();
  await expect(shelves(page).getByRole("heading", { level: 2 })).toHaveText(["Для IT · B1 → B2"]);
  await expect(offers).toHaveCount(1);
});

test("360 px: заголовок полки на паузе целиком, счётчик и «⋯» видны, без горизонтальной прокрутки", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await installEnglishPair(page);
  await page.goto("/app/course");
  await chooseLanguage(page, "Английский");
  await page.getByRole("button", { name: "Действия с курсом «Английский для общения»" }).click();
  await page.getByRole("menuitem", { name: "Приостановить курс" }).click();
  const shelf = shelves(page).nth(1);
  await expect(shelf.getByTestId("shelf-paused")).toBeVisible();
  for (const part of [
    shelf.getByRole("heading", { level: 2 }),
    shelf.getByText("0 из 1 заполнено"),
    shelf.getByRole("button", { name: "Действия с курсом «Английский для общения»", exact: true }),
    shelf.getByTestId("shelf-paused").getByText(/^На паузе с/),
    shelf.getByRole("button", { name: "Продолжить курс" }),
  ]) {
    const box = (await part.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(await part.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("1280 px — полки одна под другой", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installEnglishPair(page);
  await page.goto("/app/course");
  await chooseLanguage(page, "Английский");
  await expect(shelves(page)).toHaveCount(2);
  const [top, bottom] = await Promise.all([shelves(page).nth(0).boundingBox(), shelves(page).nth(1).boundingBox()]);
  expect(Math.abs(top!.x - bottom!.x)).toBeLessThan(1);
  expect(bottom!.y).toBeGreaterThanOrEqual(top!.y + top!.height - 1);
});

test("заголовки: «Полка» — h1, полки и карточки «+ Английский» — h2, заголовка языка нет", async ({ page }) => {
  await installBoth(page);
  await page.goto("/app/course");
  await chooseLanguage(page, "Английский");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText(["Полка"]);
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["Для IT · B1 → B2", "Английский для общения · B1"]);
  await expect(main.getByRole("heading", { name: "Английский", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Действия с курсом «Английский»" })).toBeVisible();
});

test("словарь английского: подписи курсов, фильтр «Курс» с «учу» и в адресе, чужой курс в адресе, поиск, 360 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await installEnglishPair(page);
  await overdueEnglish(page, 5, 3);
  await page.goto("/app/words");
  await chooseLanguage(page, "Английский");
  const row = (text: string) => page.getByRole("link").filter({ hasText: text });
  await expect(row("the bus")).toContainText("Для IT");
  await expect(row("a neighbour")).toContainText("Для общения");
  await expect(page.getByText("γεια", { exact: true })).toHaveCount(0);
  const lessons = page.getByTestId("dictionary-lesson");
  await expect(lessons.getByRole("heading", { level: 2 })).toContainText([/Дорога на работу/, /Знакомство/]);

  const course = page.getByRole("group", { name: "Курс" });
  await expect(course.getByRole("button")).toHaveText(["все курсы", "Для IT", "Для общения"]);
  await course.getByRole("button", { name: "Для IT" }).click();
  await page.getByRole("group", { name: "Состояние" }).getByRole("button", { name: /^учу/ }).click();
  await expect(page).toHaveURL(/course=english/);
  await expect(page).toHaveURL(/filter=learning/);
  await expect(row("the bus")).toBeVisible();
  await expect(row("a neighbour")).toHaveCount(0);
  await page.reload();
  await expect(course.getByRole("button", { name: "Для IT" })).toHaveAttribute("aria-pressed", "true");
  await expect(row("a neighbour")).toHaveCount(0);
  await course.getByRole("button", { name: "все курсы" }).click();
  await page.getByRole("group", { name: "Состояние" }).getByRole("button", { name: /^все/ }).click();
  await expect(row("the bus")).toBeVisible();

  await page.goto("/app/words?course=greek-a2");
  await expect(course.getByRole("button", { name: "все курсы" })).toHaveAttribute("aria-pressed", "true");
  await expect(row("the bus")).toBeVisible();
  await expect(row("a neighbour")).toBeVisible();

  await page.getByRole("searchbox").fill("weather");
  await expect(row("the weather")).toContainText("Для общения");
  await expect(lessons).toHaveCount(1);
  const label = row("the weather").getByText("Для общения");
  expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("тексты двух курсов языка: сводка «Прочитано 1 из 2 открытых», группы курсов со своими модулями", async ({
  page,
}) => {
  await installEnglishPair(page);
  await completeLesson(page, "e01-1");
  await completeLesson(page, "c01-1");
  await page.goto("/app/reading");
  await chooseLanguage(page, "Английский");
  await expect(page.getByTestId("reading-summary")).toHaveText("Прочитано 0 из 2 открытых");
  await page.getByRole("link", { name: /The party/ }).click();
  await page.getByRole("button", { name: "Прочитано", exact: true }).click();
  await expect(page.getByRole("button", { name: "Снять отметку" })).toBeVisible();
  await page.goto("/app/reading");
  await expect(page.getByTestId("reading-summary")).toHaveText("Прочитано 1 из 2 открытых");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["Для IT · B1 → B2", "Для общения · B1"]);
  await expect(main.getByRole("heading", { level: 3, name: /^Модуль/ })).toHaveText([
    "Модуль 1 · Work",
    "Модуль 1 · Small talk",
  ]);
  await expect(page.getByRole("link", { name: /Η Άννα/ })).toHaveCount(0);
});

test("прогресс английского: сумма и два блока курса, «% по языку» без выделения слабого, курс на паузе в своём блоке", async ({
  page,
}) => {
  await installEnglishPair(page);
  await startLesson(page, "/app/course/e01/e01-1", "Верно или неверно?", "True");
  await page.goto("/app/course");
  await chooseLanguage(page, "Английский");
  await page.getByRole("button", { name: "Действия с курсом «Английский для общения»" }).click();
  await page.getByRole("menuitem", { name: "Приостановить курс" }).click();
  await expect(shelves(page).nth(1).getByTestId("shelf-paused")).toBeVisible();
  await page.goto("/app/progress");
  const total = page.getByTestId("language-total");
  await expect(total.getByRole("heading", { level: 2 })).toHaveText("Всего по английскому");
  await expect(total.getByRole("heading", { level: 3, name: "Навыки по языку" })).toBeVisible();
  await expect(total).toContainText("Доля всех начатых курсов языка по навыку, выполненная верно.");
  await expect(total.getByRole("img", { name: /^\d+ % по языку$/ })).toHaveCount(4);
  await expect(total.locator('[data-testid^="skill-"][class*="weak"]')).toHaveCount(0);
  await expect(page.getByTestId("week")).toContainText("по курсам языка");
  const blocks = page.getByTestId("progress-course");
  await expect(blocks.getByRole("heading", { level: 2 })).toHaveText(["Для IT · B1 → B2", "Для общения · B1"]);
  await expect(blocks.nth(0).getByRole("heading", { level: 3, name: "Навыки по курсу" })).toBeVisible();
  await expect(blocks.nth(0).getByRole("img", { name: /^\d+ % курса$/ })).toHaveCount(4);
  await expect(blocks.nth(1).getByTestId("progress-paused")).toContainText(
    /^Курс на паузе с \d+ [а-я]+\. Календарь курса не сдвигается\.$/,
  );
  await expect(blocks.nth(0).getByTestId("progress-paused")).toHaveCount(0);
});
