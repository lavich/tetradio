import { expect, test, type Page } from "@playwright/test";

const GREEK_WORDS = ["γεια", "καλημέρα", "είμαι", "από", "η χώρα"];
const ENGLISH_WORDS = ["to go", "the bus", "to read", "the coffee", "to write"];

/** Модуль ставит свои уроки при открытии: так ставятся оба курса — сначала греческий, затем английский. */
async function openModule(page: Page, moduleId: string) {
  await page.goto(`/app/course/${moduleId}`);
  await expect(page.getByRole("heading", { name: "Содержание" })).toBeVisible();
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
  await expect(page).toHaveURL(/\/course\/e01\/e01-1$/);
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

test("один курс — без переключателя и без строки второго курса", async ({ page }) => {
  await openModule(page, "m01");
  await page.goto("/app/");
  await expect(page.getByTestId("course-next")).toBeVisible();
  await expect(page.getByTestId("other-course")).toHaveCount(0);
  for (const path of ["/app/words", "/app/course", "/app/progress"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Курс" })).toHaveCount(0);
  }
  await page.goto("/app/progress/settings");
  await expect(page.getByRole("heading", { name: "Занятия" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Основной курс" })).toHaveCount(0);
});
