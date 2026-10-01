import { expect, test, type Page } from "@playwright/test";

/**
 * Синтез речи подменяется, чтобы проверки не зависели от голосов машины: `none` — греческого голоса нет,
 * `instant` — голос есть и каждая реплика «звучит» мгновенно.
 */
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

/** Демонстрационный курс: модуль 01 (урок + контрольная), модуль 02 — черновик. */
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Учить курс" }).click();
  await expect(page.getByTestId("course-next")).toContainText("Знакомство и είμαι");
  // «Сегодня» курса: без расписания уроков; карточки ждут первого пройденного урока.
  await expect(page.getByTestId("cards-later")).toBeVisible();
  await expect(page.getByText("Занятие не назначено")).toHaveCount(0);
}
const section = (page: Page, name: string) => page.getByRole("region", { name });
/** Урок листается страницами: вперёд, пока нужный блок не окажется на открытой странице. */
async function turnTo(page: Page, name: string) {
  const target = page.getByRole("region", { name });
  const sheet = page.getByRole("article").first();
  const forward = page
    .getByRole("navigation", { name: "Страницы урока" })
    .getByRole("button", { name: /Далее|К итогу/ });
  await expect(sheet).toHaveAttribute("aria-label", /^Страница/);
  for (let turns = 0; turns < 20 && !(await target.count()); turns++) {
    // Ждём смены страницы, а не счётчика: счётчик меняется и от сохранения выполненного задания.
    const before = await sheet.getAttribute("aria-label");
    await forward.click();
    await expect(sheet).not.toHaveAttribute("aria-label", before!);
  }
  await expect(target).toBeVisible();
  return target;
}

test("урок курса: задания с ключом, чтение, аудирование, письмо и речь — и только потом завершение", async ({
  page,
}) => {
  await voices(page, "none");
  await start(page);
  await page.getByTestId("course-next").click();
  await expect(page.getByRole("heading", { name: "Знакомство и είμαι", level: 1 })).toBeVisible();
  await expect(page.getByTestId("page-count")).toContainText("заданий 0 из 5");
  await expect(page.getByRole("button", { name: "Завершить урок" })).toHaveCount(0);

  // Выбор формы: одна ошибка показывает правильный ответ и пояснение красной ручкой.
  const forms = await turnTo(page, "Формы είμαι");
  await forms.getByRole("group", { name: "Варианты 1" }).getByRole("button", { name: "είμαι" }).click();
  await forms.getByRole("group", { name: "Варианты 2" }).getByRole("button", { name: "είναι" }).click();
  await forms.getByRole("button", { name: "Проверить" }).click();
  await expect(forms.getByRole("status")).toHaveText("1 из 2");
  // Счёт с ошибками — янтарный, без ошибок — зелёный.
  const colorOf = (name: string) =>
    page.evaluate((name) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }, name);
  expect(await forms.getByRole("status").evaluate((node) => getComputedStyle(node).color)).toBe(
    await colorOf("--almost"),
  );
  await expect(forms).toContainText("Верно: είσαι — Εσύ — ты: είσαι.");

  // Чтение: глосса открывается касанием; задание верно/неверно.
  const reading = await turnTo(page, "Чтение: Η Άννα");
  await reading.getByRole("button", { name: "μένω" }).click();
  await expect(reading).toContainText("— живу");
  const tf = section(page, "Верно или неверно?");
  await tf.getByRole("group", { name: "Варианты 1" }).getByRole("button", { name: "Λάθος" }).click();
  await tf.getByRole("group", { name: "Варианты 2" }).getByRole("button", { name: "Σωστό" }).click();
  await tf.getByRole("button", { name: "Проверить" }).click();
  await expect(tf.getByRole("status")).toHaveText("2 из 2");
  expect(await tf.getByRole("status").evaluate((node) => getComputedStyle(node).color)).toBe(await colorOf("--ok"));

  // Аудирование: текст закрыт до ответа; без греческого голоса предлагается открыть текст.
  const listening = await turnTo(page, "Аудирование: Στο καφέ");
  await expect(listening.getByRole("list")).toHaveCount(0);
  await listening.getByRole("button", { name: "Слушать" }).click();
  await expect(listening).toContainText("На устройстве нет греческого голоса");
  await expect(listening.getByRole("button", { name: "Открыть текст" })).toBeVisible();
  const answers = section(page, "Ответьте по-гречески.");
  await answers.getByRole("textbox", { name: "Ответ 1" }).fill("Μαρια");
  await answers.getByRole("textbox", { name: "Ответ 2" }).fill("από την Ελλάδα");
  await answers.getByRole("button", { name: "Проверить" }).click();
  await expect(answers).toContainText("Почти — проверьте ударение: Μαρία");
  await expect(answers.getByRole("status")).toHaveText("2 из 2");
  // После ответа транскрипт открыт.
  await expect(listening.getByRole("list")).toContainText("Είμαι από την Ελλάδα.");

  // Письмо: образец открывается после минимального объёма; самопроверка подписана как самопроверка.
  const writing = await turnTo(page, "Письмо");
  const compare = writing.getByRole("button", { name: "Сравнить с образцом" });
  await writing.getByRole("textbox", { name: "Ваш текст" }).fill("Γεια σας! Με λένε Ιβάν.");
  await expect(compare).toBeDisabled();
  await writing
    .getByRole("textbox", { name: "Ваш текст" })
    .fill("Γεια σας! Με λένε Ιβάν. Είμαι από τη Ρωσία. Μένω στη Λευκωσία.");
  await compare.click();
  await expect(writing).toContainText("Самопроверка — не оценка экзаменатора");
  await writing.getByRole("checkbox", { name: "Есть приветствие" }).check();
  await writing.getByRole("button", { name: "Готово" }).click();
  await expect(writing.getByRole("button", { name: "Сохранить самопроверку" })).toBeVisible();

  // Речь: таймер, затем образец и критерии.
  const speaking = await turnTo(page, "Речь");
  await speaking.getByRole("button", { name: "Начать" }).click();
  await speaking.getByRole("button", { name: "Закончить" }).click();
  await expect(speaking).toContainText("Образец ответа");
  await speaking.getByRole("button", { name: "Готово" }).click();
  await expect(speaking.getByRole("button", { name: "Сохранить самопроверку" })).toBeVisible();

  // Все задания выполнены — урок можно завершить; после перезагрузки открыта та же страница, прогресс на месте.
  await page.reload();
  await expect(section(page, "Речь")).toBeVisible();
  await expect(page.getByTestId("page-count")).toContainText("заданий 5 из 5");
  await page.getByRole("button", { name: "К итогу" }).click();
  await page.getByRole("button", { name: "Завершить урок" }).click();
  await expect(page.getByRole("heading", { name: "Γνωριμία", level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: "урок пройден" })).toBeVisible();
  // Выполненное отмечено зелёной галочкой, а не красной ручкой ошибок.
  const tick = await page.getByRole("img", { name: "урок пройден" }).evaluate((node) => getComputedStyle(node).color);
  const ok = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ok)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(tick).toBe(ok);

  // Пройденный урок отдаёт карточки в повторение; следующий шаг курса — контрольная модуля.
  await page.goto("/");
  await expect(page.getByTestId("cards-today")).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить карточки" })).toBeVisible();
  await expect(page.getByTestId("course-next")).toContainText("Контрольная");
});

test("полка: опубликованный модуль и черновик; черновик нельзя пройти", async ({ page }) => {
  await start(page);
  await page.getByRole("navigation").getByRole("link", { name: "Курс" }).click();
  await expect(page.getByRole("heading", { name: "Полка", level: 1 })).toBeVisible();
  // Дата экзамена — общая, с пометкой; обратного отсчёта нет, пока дата на Кипре не подтверждена.
  await expect(page.getByTestId("exam-line")).toContainText(
    "11 мая 2027 г. — общая дата, дата на Кипре не подтверждена",
  );
  await expect(page.getByText(/осталось \d+ дн/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Модуль 1: Знакомство \(пример\)\. Открыта/ })).toBeVisible();
  await page.getByRole("link", { name: "Контрольная точка (пример)" }).click();
  await expect(page.getByRole("heading", { name: "Контрольная точка (пример)", level: 1 })).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: /Модуль 2: Страны и языки\. Готовится/ }).click();
  await expect(page.getByText("Модуль готовится")).toBeVisible();
  await expect(page.getByRole("list")).toHaveCount(0);
});

test("контрольная: итог по навыкам против порога 60 %", async ({ page }) => {
  await start(page);
  await page.goto("/course/m01/m01-test");
  const tf = await turnTo(page, "Верно или неверно?");
  await tf.getByRole("group", { name: "Варианты 1" }).getByRole("button", { name: "Σωστό" }).click();
  await tf.getByRole("group", { name: "Варианты 2" }).getByRole("button", { name: "Σωστό" }).click();
  await tf.getByRole("button", { name: "Проверить" }).click();
  const gaps = await turnTo(page, "Вставьте форму είμαι.");
  await gaps.getByRole("group", { name: "Варианты 1" }).getByRole("button", { name: "είμαστε" }).click();
  await gaps.getByRole("group", { name: "Варианты 2" }).getByRole("button", { name: "είναι" }).click();
  await gaps.getByRole("button", { name: "Проверить" }).click();
  const result = await turnTo(page, "Итог контрольной");
  await expect(result).toContainText("Итог: 3 из 4 (75 %) — порог 60 % пройден");
  await expect(result).toContainText("чтение: 1 из 2 — не сдано");
});

test("аудирование синтезом: две прослушки, затем кнопка закрыта до ответа", async ({ page }) => {
  await voices(page, "instant");
  await start(page);
  await page.getByTestId("course-next").click();
  const listening = await turnTo(page, "Аудирование: Στο καφέ");
  const play = listening.getByRole("button", { name: "Слушать" });
  await play.click();
  await expect(listening).toContainText("Прослушано 1 из 2");
  await play.click();
  await expect(listening).toContainText("Прослушано 2 из 2");
  await expect(play).toBeDisabled();
  await expect(listening.getByRole("button", { name: "Открыть текст" })).toBeVisible();
  await expect(listening.getByRole("list")).toHaveCount(0);
});

test("разворот: на широком экране две страницы рядом, стрелки листают разворот", async ({ page }) => {
  await start(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/course/m01/m01-1?p=1");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByTestId("page-count")).toContainText("стр. 1–2 из");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("page-count")).toContainText("стр. 3–4 из");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("page-count")).toContainText("стр. 1–2 из");
});

test("листание не расширяет страницу: нижнее меню не дёргается ни вперёд, ни назад", async ({ page }) => {
  await start(page);
  await page.goto("/course/m01/m01-1?p=1");
  await expect(page.getByTestId("page-count")).toBeVisible();
  // Ширина документа по кадрам анимации перелистывания.
  const widest = () =>
    page.evaluate(
      () =>
        new Promise<number>((done) => {
          let max = 0;
          let frames = 0;
          const tick = () => {
            max = Math.max(max, document.documentElement.scrollWidth);
            if (++frames < 20) requestAnimationFrame(tick);
            else done(max);
          };
          requestAnimationFrame(tick);
        }),
    );
  const pager = page.getByRole("navigation", { name: "Страницы урока" });
  const forward = widest();
  await pager.getByRole("button", { name: "Далее" }).click();
  expect(await forward).toBeLessThanOrEqual(390);
  const back = widest();
  await pager.getByRole("button", { name: "Предыдущая страница" }).click();
  expect(await back).toBeLessThanOrEqual(390);
});

test("слова урока: нажатие произносит слово или фразу, а не открывает карточку", async ({ page }) => {
  await voices(page, "instant");
  await start(page);
  await page.goto("/course/m01/m01-1?p=1");
  const words = await turnTo(page, "Слова урока");
  const first = words.getByRole("button", { name: /^Произнести: / }).first();
  const label = (await first.getAttribute("aria-label"))!.replace("Произнести: ", "");
  await first.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken ?? []))
    .toContain(label);
  await expect(page).toHaveURL(/\/course\//);
  await expect(words.getByRole("link")).toHaveCount(0);
});

test("снизу одно облачко: в разделах — меню, в уроке — листание", async ({ page }) => {
  await start(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  const menu = page.getByRole("navigation", { name: "Основные разделы" });
  const box = (await menu.boundingBox())!;
  // Облачко, а не полоса на всю ширину: компактное, по центру, с отступом от нижнего края.
  expect(box.width).toBeLessThan(400);
  expect(Math.abs(box.x + box.width / 2 - 590)).toBeLessThan(2);
  expect(box.y + box.height).toBeLessThan(820);
  await page.goto("/course/m01/m01-1?p=1");
  await expect(page.getByRole("navigation", { name: "Страницы урока" })).toBeVisible();
  await expect(menu).toHaveCount(0);
});

test("выбор варианта произносит предложение с этим вариантом", async ({ page }) => {
  await voices(page, "instant");
  await start(page);
  await page.goto("/course/m01/m01-1?p=1");
  const forms = await turnTo(page, "Формы είμαι");
  await forms.getByRole("group", { name: "Варианты 1" }).getByRole("button", { name: "είμαι" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken ?? []))
    .toContain("Εγώ είμαι η Άννα.");
});
