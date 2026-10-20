import { expect, test } from "../playwright-test";
import { type Page } from "@playwright/test";

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

test("переключатель на «Словах» меняет курс «Слов», «Курса» и «Прогресса» и переживает перезапуск", async ({
  page,
}) => {
  await installBoth(page);
  await page.goto("/app/words");
  const switcher = page.getByRole("radiogroup", { name: "Курс" });
  await switcher.getByRole("radio", { name: "Греческий" }).click();
  await expect(switcher.getByRole("radio", { name: "Греческий" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("γεια", { exact: true })).toBeVisible();
  await expect(page.getByText("the bus", { exact: true })).toHaveCount(0);

  await switcher.getByRole("radio", { name: "Английский" }).click();
  await expect(page.getByText("the bus", { exact: true })).toBeVisible();
  await expect(page.getByText("γεια", { exact: true })).toHaveCount(0);

  await page.getByRole("navigation").getByRole("link", { name: "Курс" }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Курс" }).getByRole("radio", { name: "Английский" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("link", { name: /Модуль 1: Работа/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Знакомство/ })).toHaveCount(0);

  await page.getByRole("navigation").getByRole("link", { name: "Прогресс" }).click();
  await expect(page.getByTestId("pace")).toContainText("До A2 (Ступень A2");

  await page.reload();
  await expect(
    page.getByRole("radiogroup", { name: "Курс" }).getByRole("radio", { name: "Английский" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("pace")).toContainText("До A2 (Ступень A2");

  // Стрелка переводит выбор на соседний курс.
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
    await expect(page.getByRole("radiogroup", { name: "Курс" })).toHaveCount(0);
  }
  await page.goto("/app/course");
  await expect(page.getByRole("radiogroup", { name: "Курс" }).getByRole("radio")).toHaveText([
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

test("«Все тексты» открывает раздел основного курса, даже если выбран другой; у английского текстов нет", async ({
  page,
}) => {
  await installBoth(page);
  await completeLesson(page, "m01-1");
  await page.goto("/app/words");
  await page.getByRole("radiogroup", { name: "Курс" }).getByRole("radio", { name: "Английский" }).click();
  await expect(page.getByText("the bus", { exact: true })).toBeVisible();

  await page.goto("/app/");
  await page.getByTestId("reading-all").click();
  await expect(page).toHaveURL(/\/app\/reading$/);
  await expect(
    page.getByRole("radiogroup", { name: "Курс" }).getByRole("radio", { name: "Греческий" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("link", { name: /Η Άννα/ })).toBeVisible();

  await page.getByRole("radiogroup", { name: "Курс" }).getByRole("radio", { name: "Английский" }).click();
  await expect(page.getByText("В этом курсе текстов нет.")).toBeVisible();
  await expect(page.getByTestId("reading-summary")).toHaveCount(0);
});

test("лист «Чтение» только у основного курса: у строки второго курса его нет, у английского основного — нет совсем", async ({
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
  await expect(page.getByTestId("reading-sheet")).toHaveCount(0);
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
const savedCourse = async (page: Page) =>
  (await rows<{ value?: string } | undefined>(page, "meta", "currentCourse"))?.value;
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
  const switcher = page.getByRole("radiogroup", { name: "Курс" });
  await expect(switcher.getByRole("radio", { name: "Греческий" })).toHaveAttribute("aria-checked", "true");
  await page.goto("/app/words");
  await expect(page.getByRole("radiogroup", { name: "Курс" })).toHaveCount(0);

  await page.goto("/app/course");
  await switcher.getByRole("radio", { name: "Английский, не начат" }).click();
  const offer = page.getByTestId("course-offer");
  await expect(offer.getByRole("heading", { name: "Английский · B1 → B2" })).toBeVisible();
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

  await page.goto("/app/words");
  const words = page.getByRole("radiogroup", { name: "Курс" });
  await expect(words.getByRole("radio")).toHaveText(["Греческий", "Английский"]);
  await expect(words.getByRole("radio", { name: "Английский" })).toHaveAttribute("aria-checked", "true");

  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
  await expect(page.getByTestId("other-course").getByRole("heading", { name: "Английский" })).toBeVisible();
});

test("ссылка на модуль начатого курса возвращает полку к нему", async ({ page }) => {
  await openModule(page, "m01");
  await page.goto("/app/course");
  await page.getByRole("radio", { name: "Английский, не начат" }).click();
  await expect(page.getByTestId("course-offer")).toBeVisible();
  await page.goto("/app/");
  await page.getByTestId("course-next").click();
  await expect(page).toHaveURL(/\/course\/m01\//);
  await expect.poll(() => savedCourse(page)).toBe("greek-a2");
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
  await expect(page.getByRole("radiogroup", { name: "Курс" }).getByRole("radio")).toHaveText([
    "Греческий",
    "Английский",
  ]);
  await page.goto("/app/course/e01");
  await expect(page.getByRole("heading", { name: "Содержание" })).toBeVisible();
  await expect.poll(() => lessonsOf(page, "english")).toBeGreaterThan(0);
});

test("три курса в переключателе на 360 px — имена целиком, лента прокручивается", async ({ page }) => {
  await page.route("**/content/catalog.json", async (route) => {
    const catalog = await (await route.fetch()).json();
    const lesson = catalog.lessons.find((entry: { id: string }) => entry.id === "e01-1");
    catalog.courses.push({
      id: "english-2",
      title: "Английский 2",
      language: "en",
      short: "Английский 2",
      order: 4,
      lessonIds: ["e02-copy"],
    });
    catalog.lessons.push({ ...lesson, id: "e02-copy", courseId: "english-2" });
    await route.fulfill({ json: catalog });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await openModule(page, "m01");
  await page.goto("/app/course");
  const radios = page.getByRole("radiogroup", { name: "Курс" }).getByRole("radio");
  await expect(radios).toHaveText(["Греческий", "+ Английский", "+ Английский 2"]);
  const clipped = await radios.evaluateAll(
    (items) => items.filter((item) => item.scrollWidth > item.clientWidth + 1).length,
  );
  expect(clipped).toBe(0);
});

/** Пауза и возврат с полки выбранного курса. */
async function toggleFromShelf(page: Page, course: string, action: "Приостановить курс" | "Продолжить курс") {
  await page.goto("/app/course");
  const switcher = page.getByRole("radiogroup", { name: "Курс" });
  if (await switcher.count()) await switcher.getByRole("radio", { name: course, exact: true }).click();
  await page.getByRole("button", { name: `Действия с курсом «${course}»` }).click();
  await page.getByRole("menuitem", { name: action }).click();
  const paused = page.getByTestId("shelf-paused");
  if (action === "Приостановить курс") await expect(paused).toBeVisible();
  else await expect(paused).toHaveCount(0);
}
/** Просроченные повторения английских карточек — как будто курс долго стоял на паузе. */
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

test("пауза с полки убирает английский с «Сегодня», возврат возвращает", async ({ page }) => {
  await installBoth(page);
  await toggleFromShelf(page, "Английский", "Приостановить курс");
  await expect(page.getByTestId("shelf-status")).toHaveText(
    "Курс «Английский» на паузе. Вернуть его можно на полке или в настройках.",
  );
  const paused = page.getByTestId("shelf-paused");
  await expect(paused).toContainText(/^На паузе с \d+ [а-я]+/);
  await expect(page.getByRole("link", { name: /Модуль 1: Работа/ })).toBeVisible();
  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
  await expect(page.getByTestId("other-course")).toHaveCount(0);

  await page.goto("/app/course");
  await page.getByRole("radiogroup", { name: "Курс" }).getByRole("radio", { name: "Английский", exact: true }).click();
  await paused.getByRole("button", { name: "Продолжить курс" }).click();
  await expect(paused).toHaveCount(0);
  await page.goto("/app/");
  await expect(page.getByTestId("other-course").getByRole("heading", { name: "Английский" })).toBeVisible();
});

test("основной на паузе из настроек — на «Сегодня» основным становится следующий, после возврата — прежний", async ({
  page,
}) => {
  await installBoth(page);
  await page.goto("/app/progress/settings");
  const courses = page.getByTestId("settings-courses");
  await courses.getByRole("button", { name: "Приостановить курс «Греческий»" }).click();
  await expect(page.getByTestId("courses-status")).toContainText("Курс «Греческий» на паузе");
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
  // Курс на паузе открывается на остальных экранах, как раньше.
  await page.goto("/app/words");
  const words = page.getByRole("radiogroup", { name: "Курс" });
  await words.getByRole("radio", { name: "Греческий" }).click();
  await expect(words.getByRole("radio", { name: "Греческий" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("γεια").first()).toBeVisible();

  await page.goto("/app/progress/settings");
  await courses.getByRole("button", { name: "Продолжить курс «Греческий»" }).click();
  await expect(courses.getByRole("button", { name: "Приостановить курс «Греческий»" })).toBeVisible();
  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
});

test("все курсы на паузе — «Все курсы на паузе», «Начать другой курс» открывает карточку неначатого", async ({
  page,
}) => {
  await openModule(page, "m01");
  await toggleFromShelf(page, "Греческий", "Приостановить курс");
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
  await expect(page.getByTestId("course-offer").getByRole("button", { name: "Учить курс «Английский»" })).toBeVisible();

  await page.goto("/app/");
  await page.getByRole("button", { name: /^Продолжить курс/ }).click();
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
});

test("после паузы — полное число и строка «сначала то, что могло забыться», пока долг не повторён", async ({
  page,
}) => {
  await installBoth(page);
  await startLesson(page, "/app/course/e01/e01-1", "Верно или неверно?", "False");
  await overdueEnglish(page, 3, -20);
  await toggleFromShelf(page, "Английский", "Приостановить курс");
  await page.goto("/app/");
  await expect(page.getByTestId("other-course")).toHaveCount(0);
  await toggleFromShelf(page, "Английский", "Продолжить курс");
  await page.goto("/app/");
  const other = page.getByTestId("other-course");
  await expect(other.getByRole("button", { name: "Повторить 5" })).toBeVisible();
  await expect(other.getByTestId("after-pause")).toHaveText("После паузы: сначала то, что могло забыться");
  await overdueEnglish(page, 3, 3);
  await page.reload();
  await expect(other.getByRole("button", { name: "Повторить 2" })).toBeVisible();
  await expect(other.getByTestId("after-pause")).toHaveCount(0);
});

test("меню «⋯» с клавиатуры, 44 px, полка на паузе на 360 px без прокрутки и с читаемыми подписями", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await installBoth(page);
  await page.goto("/app/course");
  const trigger = page.getByRole("button", { name: "Действия с курсом «Английский»" });
  const box = await trigger.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const item = page.getByRole("menuitem", { name: "Приостановить курс" });
  await expect(item).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(item).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(item).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("shelf-paused")).toBeVisible();
  await expect(page.getByTestId("shelf-paused").getByRole("button", { name: "Продолжить курс" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const contrast = await page.evaluate(() => {
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
    // CSS grayscale(amount) — матрица из Filter Effects для фона обложки; белый текст она не меняет.
    const gray = ([r, g, b]: number[], amount: number) => {
      const k = 1 - amount;
      return [
        (0.2126 + 0.7874 * k) * r + (0.7152 - 0.7152 * k) * g + (0.0722 - 0.0722 * k) * b,
        (0.2126 - 0.2126 * k) * r + (0.7152 + 0.2848 * k) * g + (0.0722 - 0.0722 * k) * b,
        (0.2126 - 0.2126 * k) * r + (0.7152 - 0.7152 * k) * g + (0.0722 + 0.9278 * k) * b,
      ];
    };
    const covers = [...document.querySelectorAll<HTMLElement>('a[aria-label^="Модуль"]')];
    const text = document.querySelector<HTMLElement>('[data-testid="shelf-paused"] p')!;
    let background: Element | null = text;
    while (background && getComputedStyle(background).backgroundColor === "rgba(0, 0, 0, 0)")
      background = background.parentElement;
    return {
      text: ratio(
        rgb(getComputedStyle(text).color),
        rgb(getComputedStyle(background ?? document.body).backgroundColor),
      ),
      covers: covers.map((cover) => {
        const bg = rgb(getComputedStyle(cover).backgroundColor);
        const fg = rgb(getComputedStyle(cover).color);
        return { before: ratio(fg, bg), after: ratio(fg, gray(bg, 0.85)) };
      }),
    };
  });
  expect(contrast.text).toBeGreaterThanOrEqual(4.5);
  for (const cover of contrast.covers) expect(cover.after).toBeGreaterThanOrEqual(Math.min(4.5, cover.before));
});
