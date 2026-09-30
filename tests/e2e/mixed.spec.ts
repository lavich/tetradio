import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GREEK_VOICE, installLessons, ready, readTable, seedMixedLesson, setCourseLimit } from "./helpers";
import { onlyReviews, openTelegram, tg } from "./telegram";

/**
 * Смешанный урок из непубликуемой фикстуры: слова и фразы в одном занятии.
 * Урок кладётся в базу как установленный пакет; реальный каталог его не содержит.
 * Голос браузера подменяется явно: доступность аудирования фразы не должна зависеть от набора голосов машины.
 */
const NO_VOICE = `Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
 getVoices:()=>[],speak(){},cancel(){},addEventListener(){},removeEventListener(){},
}});`;

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
/** Тексты фикстуры: письменный ответ вводится целиком, из интерфейса до ответа он недоступен. */
const TEXTS: Record<string, string> = {
  "Я пишу письмо.": "Γράφω ένα γράμμα.",
  "Гора высокая.": "Το βουνό είναι ψηλό.",
  "Ребёнок играет в парке.": "Το παιδί παίζει στο πάρκο.",
  "Весна приносит цветы.": "Η άνοιξη φέρνει λουλούδια.",
  "Дочь смотрит на солнце и улыбается.": "Η κόρη βλέπει τον ήλιο και χαμογελάει.",
};
const textFor = (prompt: string) => Object.entries(TEXTS).find(([hint]) => prompt.includes(hint))?.[1];
const INTRO = ["Новая фраза", "Новое слово"];
/** Счётчик занятия: по нему ждём перерисовку, иначе подпись задания читается от предыдущего шага. */
const counter = (page: Page) => page.getByLabel(/^(Знакомство|Упражнение) \d+ из \d+$/);
const promptOf = async (page: Page) => {
  await counter(page).waitFor();
  return page.getByTestId("prompt").first().innerText();
};
/** «Далее» с ожиданием смены счётчика: следующий шаг читается уже из нового состояния. */
async function advance(page: Page) {
  const previous = await counter(page).getAttribute("aria-label");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByLabel(previous!, { exact: true })).toHaveCount(0);
}

/** Осталось ли одно незакрытое задание при хотя бы одном ответе: дальше занятие завершится и перестанет быть начатым. */
async function lastUnanswered(page: Page) {
  const session = (await readTable(page, "sessions")).find((row) => row.status === "active");
  if (!session) return false;
  const open = session.items.filter((item: { eventId?: string; skipped?: boolean }) => !item.eventId && !item.skipped);
  return open.length <= 1 && session.items.length > open.length;
}

/** Установленный урок 1.1 даёт слово фикстуры; смешанный урок получает ближайшую дату, поэтому его карточки идут первыми. */
async function prepare(page: Page, limit: number, options: Parameters<typeof seedMixedLesson>[1] = {}) {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-1"]);
  await setCourseLimit(page, "leeke", limit);
  return seedMixedLesson(page, { targetDate: tomorrow(), ...options });
}

test("экран урока: группы двух видов, просмотр карточек, непроверяемая фраза, удаление связи и нетронутый раздел «Слова»", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.addInitScript(NO_VOICE);
  await prepare(page, 4);
  await page.goto("/lessons/lesson-mixed");
  await expect(page.getByTestId("composition")).toContainText("7 карточек: 1 слово · 6 фраз");
  await expect(page.getByRole("heading", { name: "Слова · 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Фразы · 6" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Заполни пропуск/ })).toHaveCount(0); // снятого вида на экране нет
  // Фраза без перевода и озвучки помечена отдельно и объясняет ограничение при раскрытии.
  const silent = page.getByTestId("phrase-row").filter({ hasText: "Το φρύδι της είναι λεπτό." });
  await expect(silent.getByTestId("unavailable-badge")).toHaveText("Нет доступного упражнения");
  await silent.getByRole("button", { name: "Το φρύδι της είναι λεπτό." }).click();
  await expect(silent.getByTestId("phrase-details")).toContainText("нельзя проверить объективно");
  await expect(page.getByText("1 фраза без доступного упражнения")).toBeVisible();
  // Просмотр фразы: перевод в подписи, примечание из материала — в раскрытии.
  const ilios = page.getByTestId("phrase-row").filter({ hasText: "Η κόρη βλέπει τον ήλιο" });
  await ilios.getByRole("button", { name: /Η κόρη βλέπει τον ήλιο/ }).click();
  await expect(ilios.getByTestId("phrase-details")).toContainText("Винительный падеж");
  // Удаление связи: карточка исчезает из группы, сама карточка и запись об удалении остаются.
  await page.getByTestId("phrase-row").filter({ hasText: "άνοιξη" }).getByRole("button", { name: "Убрать" }).click();
  await expect(page.getByRole("heading", { name: "Фразы · 5" })).toBeVisible();
  await expect(page.getByTestId("composition")).toContainText("6 карточек");
  expect((await readTable(page, "phrases")).some((row) => row.id === "p-anoixi")).toBe(true);
  expect((await readTable(page, "packages")).find((row) => row.lessonId === "lesson-mixed").removed).toEqual([
    JSON.stringify(["phrase", "p-anoixi"]),
  ]);
  // Раздел «Слова» остаётся словарём слов: фразы туда не попадают.
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await page.getByRole("searchbox").fill("Γράφω ένα");
  await expect(page.getByTestId("word-count")).toHaveText("0 слов");
  await page.getByRole("searchbox").fill("γράφω");
  await expect(page.getByRole("link", { name: /γράφω/ })).toBeVisible();
  await expect(page.getByTestId("word-count")).toHaveText("1 слово");
});

test("при системном голосе фраза без перевода проверяема аудированием", async ({ page }) => {
  test.setTimeout(150000);
  await page.addInitScript(GREEK_VOICE);
  await prepare(page, 4);
  await page.goto("/lessons/lesson-mixed");
  const silent = page.getByTestId("phrase-row").filter({ hasText: "Το φρύδι της είναι λεπτό." });
  await expect(silent.getByTestId("unavailable-badge")).toHaveCount(0);
  await expect(page.getByText("без доступного упражнения")).toHaveCount(0);
  // Ручная тренировка группы фраз начинается: знакомства, затем проверки.
  await page.getByTestId("group-phrase").getByRole("button", { name: "Потренировать группу" }).click();
  await page.waitForURL("**/session");
  for (let step = 0; step < 10; step++) {
    if ((await promptOf(page)) !== "Новая фраза") break;
    await advance(page);
  }
  expect(INTRO).not.toContain(await promptOf(page)); // знакомства закончились, идёт проверка
});

test("урок без слов не пуст, а группа без доступных заданий сообщает об этом", async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(NO_VOICE);
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-1"]);
  await seedMixedLesson(page, {
    lessonId: "lesson-text",
    title: "Только фразы",
    only: ["p-grafo", "p-silent"],
  });
  await page.goto("/lessons/lesson-text");
  await expect(page.getByTestId("composition")).toContainText("2 карточки: 2 фразы");
  await expect(page.getByRole("heading", { name: /^Слова ·/ })).toHaveCount(0);
  await expect(page.getByText("В наборе пока нет карточек")).toHaveCount(0);
  // Пока в группе есть проверяемая фраза, тренировка начинается.
  await page.getByTestId("group-phrase").getByRole("button", { name: "Потренировать группу" }).click();
  await page.waitForURL("**/session");
  await expect(page.getByTestId("prompt").first()).toHaveText(/Новая фраза|Что значит эта фраза\?|Напиши по-гречески/);
  // Группа из одной непроверяемой фразы: тренировка не начинается, сообщение на месте.
  await page.goto("/lessons/lesson-text");
  await page
    .getByTestId("phrase-row")
    .filter({ hasText: "Γράφω ένα γράμμα." })
    .getByRole("button", { name: "Убрать" })
    .click();
  await expect(page.getByRole("heading", { name: "Фразы · 1" })).toBeVisible();
  await page.getByTestId("group-phrase").getByRole("button", { name: "Потренировать группу" }).click();
  await expect(page.getByRole("alert")).toContainText("В группе «Фразы» нет доступных заданий");
  await expect(page).toHaveURL(/\/lessons\/lesson-text$/);
  // Список уроков считает карточки, а не слова.
  await page.goto("/lessons");
  await expect(page.getByRole("link", { name: /Только фразы/ })).toContainText("1 карточка");
});

test("занятие: знакомство с фразой, «Не знаю» с дополнительной попыткой и продолжение после перезапуска без сети", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  await page.addInitScript(NO_VOICE);
  await prepare(page, 4);
  await page.setViewportSize({ width: 360, height: 560 }); // узкая ширина с местом под экранную клавиатуру; остальные сценарии идут на 390 из конфигурации
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await page.waitForURL("**/session");

  // Знакомства всех новых видов идут общим проходом до проверок.
  const intros: string[] = [];
  for (let step = 0; step < 12; step++) {
    const prompt = await promptOf(page);
    if (!INTRO.includes(prompt)) break;
    intros.push(prompt);
    if (prompt === "Новая фраза") await expect(page.getByTestId("phrase-text")).toBeVisible();
    await expect(page.getByLabel(/^Знакомство \d+ из \d+$/)).toBeVisible();
    await advance(page);
  }
  expect(intros).toEqual(expect.arrayContaining(["Новая фраза"]));

  const seen = new Set<string>();
  let skipped = false,
    restarted = false;
  for (let step = 0; step < 40; step++) {
    if (await page.getByRole("heading", { name: "Занятие завершено" }).isVisible()) break;
    const prompt = await promptOf(page);
    seen.add(prompt);
    // Тип упражнения выбирает планировщик, поэтому сценарий не зависит от него: «Не знаю» есть у каждого задания.
    if (!skipped) {
      await page.getByRole("button", { name: "Не знаю", exact: true }).click();
      // Раскрытие выглядит по-разному: в выборе — отмеченный вариант, в письме — плашка исхода.
      await expect(page.getByTestId("feedback").or(page.locator("[data-answer]").first())).toBeVisible();
      skipped = true;
    } else if (prompt === "Напиши по-гречески") {
      const asked = await page.locator("main").innerText();
      const expected = textFor(asked);
      const input = page.getByLabel("Твой ответ по-гречески");
      if (expected) {
        // Письменный ответ фразы: правильного написания нет ни в тексте, ни в разметке — только маска длины.
        expect(asked).not.toContain(expected);
        expect(await page.locator("main").innerHTML()).not.toContain(expected);
      }
      await expect(page.getByRole("button", { name: "Проверить" })).toBeDisabled(); // пустой ввод не проверяется
      await input.fill(expected ?? "λάθος");
      await input.press("Enter"); // Enter отправляет ответ
      await expect(page.getByTestId("feedback")).toBeVisible();
      await expect(page.getByTestId("reveal")).toBeVisible(); // после ответа материал раскрыт
    } else if (prompt === "Что значит эта фраза?" || prompt === "Что значит это слово?") {
      await page.getByTestId("option").and(page.locator(":not([disabled])")).first().click();
      await expect(page.locator("[data-answer]").first()).toBeVisible();
    } else if (prompt === "Собери слово") {
      for (const tile of await page.getByTestId("tile").all()) await tile.click();
      await page.getByRole("button", { name: "Проверить" }).click();
      await expect(page.getByTestId("feedback")).toBeVisible();
    } else throw new Error(`Неожиданное задание: ${prompt}`);
    await expect(page.getByRole("button", { name: "Далее", exact: true })).toBeVisible();
    if (skipped && !restarted) {
      // Перезапуск без сети: сохранённые ответы не запрашиваются снова, знакомства не повторяются.
      restarted = true;
      const answered = (await readTable(page, "events")).length;
      await context.setOffline(true);
      await page.goto("/");
      await ready(page);
      await page.getByRole("button", { name: /Продолжить занятие/ }).click();
      await page.waitForURL("**/session");
      await expect(page.getByRole("button", { name: "Далее", exact: true })).toHaveCount(0);
      expect(INTRO).not.toContain(await page.getByTestId("prompt").first().innerText());
      expect((await readTable(page, "events")).length).toBe(answered);
      await context.setOffline(false);
      continue;
    }
    await advance(page);
  }
  expect(seen.size).toBeGreaterThan(0);
  expect(skipped && restarted).toBe(true);
  await expect(page.getByRole("heading", { name: "Занятие завершено" })).toBeVisible();
  await expect(page.getByTestId("composition")).toContainText("фраз");

  // Ответы сохранены, сроки независимы: ошибка не сдвинула остальные карточки.
  const events = await readTable(page, "events");
  const failed = events.find((item) => item.correct === false);
  expect(failed.snapshot.text ?? failed.snapshot.greek).toBeTruthy();
  // Каждая ошибка добавила дополнительную попытку своей карточки, и не больше одной на карточку.
  const session = (await readTable(page, "sessions")).find((row) =>
    row.items.some((i: { retryOf?: string }) => i.retryOf),
  );
  const retries = session.items.filter((item: { retryOf?: string }) => item.retryOf);
  expect(retries.length).toBeGreaterThan(0);
  expect(retries.every((item: { mode: string }) => item.mode === "practice")).toBe(true);
  expect(new Set(retries.map((item: { retryOf: string }) => item.retryOf)).size).toBe(retries.length);
  const states = await readTable(page, "cardStates");
  const due = (key: string) => new Date(states.find((state) => state.unitKey === key).card.due).getTime();
  const others = states.filter((state) => state.unitKey !== failed.unitKey);
  expect(others.length).toBeGreaterThan(0);
  expect(others.some((state) => due(state.unitKey) !== due(failed.unitKey))).toBe(true);
  expect(new Set(states.map((state) => state.ref.kind)).size).toBeGreaterThan(1); // карточки разных видов ведут свой прогресс
});

test("полная копия переносит смешанный урок с прогрессом во второй профиль", async ({ browser }) => {
  test.setTimeout(180000);
  const source = await browser.newContext();
  const page = await source.newPage();
  await page.addInitScript(NO_VOICE);
  await prepare(page, 3);
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await page.waitForURL("**/session");
  for (let step = 0; step < 20; step++) {
    const prompt = await promptOf(page);
    if (INTRO.includes(prompt)) {
      await advance(page);
      continue;
    }
    // Копия должна содержать начатое занятие: последнее незакрытое задание остаётся без ответа.
    if (await lastUnanswered(page)) break;
    if (await page.getByTestId("option").first().isVisible()) {
      await page.getByTestId("option").first().click();
      await expect(page.locator("[data-answer]").first()).toBeVisible();
      await advance(page);
      continue;
    }
    if (await page.getByLabel("Твой ответ по-гречески").isVisible()) {
      await page.getByLabel("Твой ответ по-гречески").fill("λάθος");
      await page.getByRole("button", { name: "Проверить" }).click();
      await expect(page.getByTestId("feedback")).toBeVisible();
      await advance(page);
      continue;
    }
    if (await page.getByTestId("tile").first().isVisible()) {
      for (const tile of await page.getByTestId("tile").all()) await tile.click();
      await page.getByRole("button", { name: "Проверить" }).click();
      await expect(page.getByTestId("feedback")).toBeVisible();
      await advance(page);
      continue;
    }
    throw new Error(`Неожиданное задание: ${prompt}`);
  }
  const events = (await readTable(page, "events")).length;
  const states = (await readTable(page, "cardStates")).length;
  expect(events).toBeGreaterThan(0);
  await page.goto("/");
  await ready(page);
  await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
  await page.getByRole("link", { name: /Копия данных/ }).click();
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Сохранить полную копию" }).click(),
  ]).then(([item]) => item);
  const file = join(tmpdir(), `lexi-mixed-${Date.now()}.json`);
  writeFileSync(file, readFileSync(await download.path()));
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const rows = (name: string) => parsed.data.data.find((table: { tableName: string }) => table.tableName === name).rows;
  // Считаем карточки самого смешанного урока, а не всю базу: в каталоге есть и свои фразы.
  const linked = rows("lessonItems").filter((row: { lessonId: string }) => row.lessonId === "lesson-mixed") as {
    ref: { kind: string; id: string };
  }[];
  const ofMixed = (name: string, kind: string) =>
    rows(name).filter((row: { id: string }) => linked.some((link) => link.ref.kind === kind && link.ref.id === row.id));
  expect(linked).toHaveLength(7);
  expect(ofMixed("phrases", "phrase")).toHaveLength(6);
  expect(rows("sessions").some((row: { status: string }) => row.status === "active")).toBe(true);
  await source.close();

  const clean = await browser.newContext();
  const fresh = await clean.newPage();
  await fresh.addInitScript(NO_VOICE);
  await fresh.goto("/");
  await ready(fresh);
  await fresh.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
  await fresh.getByRole("link", { name: /Копия данных/ }).click();
  await fresh.locator("#backup").setInputFiles(file);
  await expect(fresh.getByText(/Файл проверен/)).toBeVisible();
  await fresh.getByRole("button", { name: "Заменить данные копией" }).click();
  await Promise.all([
    fresh.waitForEvent("download"),
    fresh.getByRole("button", { name: "Заменить", exact: true }).click(),
  ]);
  await expect(fresh.getByText("Данные восстановлены полностью.")).toBeVisible();
  await fresh.goto("/lessons/lesson-mixed");
  await expect(fresh.getByTestId("composition")).toContainText("7 карточек: 1 слово · 6 фраз");
  await expect(fresh.getByRole("heading", { name: "Фразы · 6" })).toBeVisible();
  expect((await readTable(fresh, "events")).length).toBe(events);
  expect((await readTable(fresh, "cardStates")).length).toBe(states);
  await fresh.goto("/");
  await ready(fresh);
  await expect(fresh.getByRole("button", { name: /Продолжить занятие/ })).toBeVisible(); // занятие продолжается на втором профиле
  await clean.close();
});

test("внутри Telegram: возврат из свёрнутого клиента не сбрасывает задание фразы, нативный «Назад» выходит с сохранением", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.addInitScript(NO_VOICE);
  await openTelegram(page, { noCloud: true });
  await installLessons(page, ["lesson-1-1"]);
  const TG_DB = "lexi-tg-TaveloriBot-1001";
  await onlyReviews(page);
  await setCourseLimit(page, "leeke", 2, TG_DB);
  await seedMixedLesson(page, { targetDate: today(), only: ["p-grafo", "p-vouno"], databaseName: TG_DB });
  await page.getByRole("button", { name: /Начать занятие/ }).click();
  await page.waitForURL("**/session");
  // Знакомства проходим, дальше берём первое же задание: тип выбирает планировщик.
  for (let step = 0; step < 8; step++) {
    if (!INTRO.includes(await promptOf(page))) break;
    await advance(page);
  }
  const prompt = await promptOf(page);
  const label = await counter(page).getAttribute("aria-label");
  const input = page.getByLabel("Твой ответ по-гречески");
  const typed = await input.count();
  if (typed) await input.fill("γρά");
  const bridge = tg(page);
  await bridge.deactivate();
  await bridge.activate(700);
  // Возврат из Telegram не сбросил задание: та же позиция, та же подпись, набранное на месте.
  await expect(counter(page)).toHaveAttribute("aria-label", label!);
  expect(await page.getByTestId("prompt").first().innerText()).toBe(prompt);
  if (typed) {
    await expect(input).toHaveValue("γρά");
    await input.press("Enter");
  } else {
    await page.getByTestId("option").and(page.locator(":not([disabled])")).first().click();
  }
  await expect(page.getByTestId("feedback").or(page.locator("[data-answer]").first())).toBeVisible();
  await bridge.back();
  await expect(page.getByTestId("today-title")).toBeVisible();
  expect((await readTable(page, "events", TG_DB)).filter((row) => row.ref.kind === "phrase")).toHaveLength(1);
});
