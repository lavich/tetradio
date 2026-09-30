import { expect, test } from "@playwright/test";
import { breakStorage, installLessons, seedQueue } from "./helpers";
import { DARK, LIGHT, onlyReviews, openTelegram, tg } from "./telegram";

/** База Telegram-профиля тестового пользователя: отдельная от браузерной `lexi`. */
const TG_DB = "lexi-tg-TaveloriBot-1001";

test.describe("запуск внутри Telegram", () => {
  test("экран «Сегодня», ready/expand, компактная шапка, первый запуск без запроса аккаунта", async ({ page }) => {
    await page.addInitScript(`window.__tgReady=false`);
    await page.addInitScript((await import("./telegram")).bridgeScript({}));
    await page.goto(`/${(await import("./telegram")).launchHash({})}`);
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("компактный прогресс");
    await expect(dialog).toContainText("Номер телефона, доступ к сообщениям и отдельный аккаунт не нужны");
    await dialog.getByRole("button", { name: "Понятно" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("today-title")).toBeVisible();
    const calls = await tg(page).calls();
    expect(calls).toContain("ready");
    expect(calls).toContain("expand");
    expect(calls.filter((call) => call === "ready")).toHaveLength(1);
    expect(await page.locator("html").getAttribute("data-platform")).toBe("telegram");
    await expect(page.locator("header")).toHaveCount(0); // бренд и бургер не дублируют шапку клиента
    await expect(page.getByRole("navigation").getByRole("link", { name: "Ещё" })).toBeVisible(); // «Ещё» остаётся в нижней навигации
    await page.reload();
    await expect(page.getByTestId("today-title")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0); // сообщение первого запуска не повторяется
  });
  test("обычный браузер не ждёт Telegram, не показывает вход и хранит данные в этом браузере", async ({ page }) => {
    await page.route("https://telegram.org/**", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByTestId("today-title")).toBeVisible();
    expect(await page.locator("html").getAttribute("data-platform")).toBe("web");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
    await expect(page.getByTestId("storage-scope")).toContainText("В этом браузере");
    await expect(page.getByTestId("storage-scope")).toContainText("Вход через Telegram здесь не нужен");
    await expect(page.getByTestId("sync-status")).toHaveCount(0);
    await expect(page.locator("header").getByText("lexi")).toBeVisible();
  });
  test("ошибка загрузки bridge при запуске из Telegram оставляет обычный интерфейс", async ({ page }) => {
    await page.route("https://telegram.org/**", (route) => route.abort());
    const { launchHash } = await import("./telegram");
    await page.goto(`/${launchHash({})}`);
    await page.getByRole("alertdialog").getByRole("button", { name: "Понятно" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByTestId("today-title")).toBeVisible();
    await page.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();
    await expect(page.getByRole("button", { name: "Назад" })).toHaveCount(0);
    await page.getByRole("link", { name: /1\.2/ }).click();
    await expect(page.getByRole("button", { name: "Назад" })).toBeVisible(); // нативной кнопки нет — внутренняя остаётся
  });
});

test.describe("навигация, тема и размеры", () => {
  test("BackButton скрыт на «Сегодня», ведёт назад из урока и слова, из занятия выходит с сохранением ответов", async ({
    page,
  }) => {
    await openTelegram(page, { noCloud: true }); // без облака: подготовленная в базе история не отсекается базой синхронизации
    await installLessons(page, ["lesson-1-1"]);
    const bridge = tg(page);
    expect(await bridge.backVisible()).toBe(false);
    await page.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();
    await expect.poll(() => bridge.backVisible()).toBe(true);
    await page.getByRole("link", { name: /1\.1/ }).click();
    await expect(page.getByRole("heading", { name: /^Слова · \d+$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Назад" })).toHaveCount(0); // внутренняя стрелка заменена нативной
    await bridge.back();
    await expect(page).toHaveURL(/\/lessons$/);
    await page.getByRole("link", { name: /1\.1/ }).click();
    await page.getByRole("link", { name: /διαβάζω/ }).click();
    await expect(page.getByRole("button", { name: "Потренировать слово" })).toBeVisible();
    await bridge.back();
    await expect(page.getByRole("heading", { name: /^Слова · \d+$/ })).toBeVisible();
    await bridge.back();
    await bridge.back();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => bridge.backVisible()).toBe(false);
    // Без внутренней истории возврат ведёт на «Сегодня».
    await page.goto("/more/stats");
    await expect(page.getByRole("heading", { name: "Статистика" })).toBeVisible();
    await bridge.back();
    await expect(page.getByTestId("today-title")).toBeVisible();
    // Из занятия: принятый ответ сохранён, выход через BackButton, продолжение после перезагрузки.
    await onlyReviews(page);
    await seedQueue(
      page,
      [
        { wordId: "w11-01", tested: ["recall"] },
        { wordId: "w11-02", tested: ["recall"] },
      ],
      TG_DB,
    );
    await page.getByRole("button", { name: /Начать занятие/ }).click();
    await page.waitForURL("**/session");
    await page.getByTestId("option").and(page.locator(":not([disabled])")).first().click();
    await expect(page.getByRole("button", { name: "Далее", exact: true })).toBeVisible();
    const calls = await bridge.calls();
    expect(calls.filter((call) => call.startsWith("haptic:"))).toHaveLength(1);
    // Закрытие Mini App после ответа: перезагрузка возвращает в сохранённое занятие, ответ учтён один раз.
    await page.goto("/");
    await page.getByRole("button", { name: /Продолжить занятие/ }).click();
    await expect(page.getByTestId("prompt").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Далее", exact: true })).toHaveCount(0); // продолжаем со следующего упражнения
    await bridge.back(); // нативный «Назад» = существующий выход из занятия
    await expect(page.getByTestId("today-title")).toBeVisible();
    await expect(page.getByRole("button", { name: /Начать занятие/ })).toBeVisible();
    const events = await page.evaluate(async () => {
      const request = indexedDB.open("lexi-tg-TaveloriBot-1001");
      const database = await new Promise<IDBDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      const all = database.transaction("events").objectStore("events").getAllKeys();
      return new Promise<number>((resolve) => {
        all.onsuccess = () => resolve((all.result as string[]).filter((key) => String(key).startsWith("e-")).length);
      });
    });
    expect(events).toBe(1); // ровно одно событие на принятый ответ, подготовленная история не в счёт
  });
  test("тема клиента и неполные параметры: фон и действия адаптируются, статусы ответа различимы, упражнение не сбрасывается", async ({
    page,
  }) => {
    await openTelegram(page, { scheme: "light", noCloud: true });
    await installLessons(page, ["lesson-1-1"]);
    const color = (property: string) =>
      page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), property);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await bg()).toBe("rgb(255, 255, 255)");
    await tg(page).setTheme("dark", DARK);
    await expect.poll(bg).toBe("rgb(23, 33, 43)");
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
    // Неполная тема: нет секции и подсказки — резервные значения, текст читаем.
    await tg(page).setTheme("dark", { bg_color: "#101010", text_color: "#eeeeee" });
    await expect.poll(bg).toBe("rgb(16, 16, 16)");
    const text = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(text).toBe("rgb(238, 238, 238)");
    expect((await color("--muted-foreground")).length).toBeGreaterThan(0);
    await onlyReviews(page);
    await seedQueue(page, [{ wordId: "w11-01", tested: ["recall"] }], TG_DB);
    await page.getByRole("button", { name: /Начать занятие/ }).click();
    await page.waitForURL("**/session");
    const prompt = await page.getByTestId("prompt").first().innerText();
    await tg(page).setTheme("light", LIGHT);
    await expect(page.getByTestId("prompt").first()).toHaveText(prompt); // смена темы не сбросила упражнение
    await page.getByTestId("option").and(page.locator(":not([disabled])")).first().click();
    const correct = page.locator('[data-answer="correct"]');
    await expect(correct).toBeVisible();
    await expect(correct.locator(".sr-only")).toContainText("Правильный ответ"); // статус сопровождается текстом
    const light = await correct.evaluate((node) => getComputedStyle(node).backgroundColor);
    await tg(page).setTheme("dark", DARK);
    await expect.poll(() => correct.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(light);
    await expect(page.getByRole("button", { name: "Далее", exact: true })).toBeVisible();
  });
  test("во весь экран: контент начинается ниже системной строки и кнопок клиента, режим виден на «Ещё»", async ({
    page,
  }) => {
    await openTelegram(page, { noCloud: true, fullscreen: true, safeTop: 47, contentTop: 46 });
    expect(await page.locator("html").getAttribute("data-launch-mode")).toBe("fullscreen");
    const main = page.locator("main").first();
    await expect.poll(() => main.evaluate((node) => parseFloat(getComputedStyle(node).paddingTop))).toBe(12 + 47 + 46);
    const heading = await page.getByTestId("today-title").boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(93);
    // Пользователь свернул из полного экрана: отступ уходит вместе с кнопками клиента.
    await tg(page).setFullscreen(false, 0, 0);
    await expect.poll(() => page.locator("html").getAttribute("data-launch-mode")).toBe("fullsize");
    await expect.poll(() => main.evaluate((node) => parseFloat(getComputedStyle(node).paddingTop))).toBe(12);
    await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
    await expect(page.getByTestId("launch-mode")).toContainText("режим: полноразмерный");
    await tg(page).setFullscreen(true, 47, 46);
    await expect(page.getByTestId("launch-mode")).toContainText("режим: во весь экран"); // обновляется без перезагрузки
    // Занятие во весь экран: строка прогресса в полосе кнопок клиента, крестика нет — закрывает нативный «Назад».
    await installLessons(page, ["lesson-1-1"]);
    await onlyReviews(page);
    await seedQueue(page, [{ wordId: "w11-01", tested: ["recall"] }], TG_DB);
    await page.getByRole("button", { name: /Начать занятие/ }).click();
    await page.waitForURL("**/session");
    await expect(page.getByRole("button", { name: "Закрыть занятие" })).toHaveCount(0);
    const bar = await page.getByRole("progressbar").boundingBox();
    expect(bar!.y).toBeGreaterThanOrEqual(47);
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(47 + 46);
    expect(bar!.x).toBeGreaterThanOrEqual(390 * 0.26 - 1);
    await tg(page).back();
    await expect(page.getByTestId("today-title")).toBeVisible();
  });
  test("экран результата во весь экран начинается ниже системной строки и кнопок клиента", async ({ page }) => {
    await openTelegram(page, { noCloud: true, fullscreen: true, safeTop: 47, contentTop: 46 });
    // Занятие уже закрыто: экран результата проверяем по разметке, а не по прохождению упражнений.
    await page.evaluate(async (databaseName) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
      });
      const now = new Date().toISOString();
      const tx = database.transaction(["sessions", "events"], "readwrite");
      tx.objectStore("sessions").put({
        id: "done",
        createdAt: now,
        planDate: "2026-09-16",
        items: [],
        index: 0,
        status: "done",
        activeTimeMs: 60000,
        introducedKeys: [],
      });
      tx.objectStore("events").put({
        id: "e-done",
        sessionId: "done",
        itemId: "i-done",
        ref: { kind: "word", id: "w11-01" },
        unitKey: JSON.stringify(["word", "w11-01"]),
        snapshot: { greek: "", russian: "" },
        type: "recognition",
        mode: "scheduled",
        correct: true,
        rating: 3,
        answer: "",
        localDate: "2026-09-16",
        createdAt: now,
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    }, TG_DB);
    await page.evaluate(() => {
      history.pushState({}, "", "session/result/done");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByRole("heading", { name: "Занятие завершено" })).toBeVisible();
    const main = page.locator("main").first();
    await expect.poll(() => main.evaluate((node) => parseFloat(getComputedStyle(node).paddingTop))).toBe(24 + 47 + 46);
    const heading = await page.getByRole("heading", { name: "Занятие завершено" }).boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(47 + 46); // заголовок не заезжает под кнопки клиента
    await tg(page).setFullscreen(false, 0, 0);
    await expect.poll(() => main.evaluate((node) => parseFloat(getComputedStyle(node).paddingTop))).toBe(24); // свернули — остаётся только собственный воздух экрана
  });
  test("ширины 360 и 390, устойчивая высота и клавиатура: поле ответа и кнопка доступны без горизонтальной прокрутки", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openTelegram(page, { stableHeight: 740, platform: "android", noCloud: true });
    await installLessons(page, ["lesson-1-1"]);
    await onlyReviews(page);
    await seedQueue(page, [{ wordId: "w11-01", tested: ["recall", "recognition", "assembly", "assembly"] }], TG_DB);
    await page.getByRole("button", { name: /Начать занятие/ }).click();
    await page.waitForURL("**/session");
    await expect(page.getByTestId("prompt").first()).toHaveText("Напиши по-гречески");
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    const input = page.getByLabel("Твой ответ по-гречески");
    const check = page.getByRole("button", { name: "Проверить" });
    // Маска длины переносится по словам и остаётся в доке вместе с полем и кнопкой.
    const hint = page.getByTestId("answer-mask");
    await expect(hint).toBeVisible();
    await input.focus();
    // Клавиатура: устойчивая высота уменьшается — док остаётся в видимой области.
    await tg(page).setViewport(420, false); // промежуточный кадр анимации игнорируется
    await tg(page).setViewport(420, true);
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim()),
      )
      .toBe("420px");
    for (const element of [hint, input, check]) {
      const box = await element.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(420 + 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    }
    await tg(page).setViewport(740, true);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await overflow()).toBeLessThanOrEqual(0);
    await input.fill("το σπίτι");
    await check.click();
    await expect(page.getByTestId("feedback")).toBeVisible();
  });
  test("свернули → вернули (Bot API 8.0): нулевой viewport не схлопывает занятие, после возврата экран виден, тема и размеры перечитаны", async ({
    page,
  }) => {
    await openTelegram(page, { noCloud: true, scheme: "light" });
    await installLessons(page, ["lesson-1-1"]);
    await onlyReviews(page);
    await seedQueue(page, [{ wordId: "w11-01", tested: ["recall"] }], TG_DB);
    await page.getByRole("button", { name: /Начать занятие/ }).click();
    await page.waitForURL("**/session");
    const prompt = await page.getByTestId("prompt").first().innerText();
    const height = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim());
    const sessionHeight = () =>
      page
        .locator("main")
        .first()
        .evaluate((node) => node.getBoundingClientRect().height);
    const active = () => page.locator("html").getAttribute("data-app-active");
    await expect.poll(height).toBe("844px");
    expect(await active()).toBe("true");
    await tg(page).deactivate();
    await expect.poll(active).toBe("false");
    expect(await height()).toBe("844px");
    expect(await sessionHeight()).toBeGreaterThan(400);
    await tg(page).silentTheme("dark", DARK);
    await tg(page).activate(780);
    await expect.poll(active).toBe("true");
    await expect.poll(height).toBe("780px"); // размеры перечитаны по одному activated, без viewportChanged
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe("rgb(23, 33, 43)"); // тема перечитана
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
    await expect(page.getByTestId("prompt").first()).toBeVisible();
    await expect(page.getByTestId("prompt").first()).toHaveText(prompt); // упражнение не сброшено
    expect(await sessionHeight()).toBeGreaterThan(400);
    await page.getByTestId("option").and(page.locator(":not([disabled])")).first().click();
    await expect(page.getByRole("button", { name: "Далее", exact: true })).toBeVisible(); // занятие отвечает на касания после возврата
  });
  test("клиент без Bot API 8.0: подписка на activated отвергнута — запуск не пострадал, возврат виден по видимости документа", async ({
    page,
  }) => {
    await openTelegram(page, { noCloud: true, version: "7.0", scheme: "light" });
    await installLessons(page, ["lesson-1-1"]);
    expect(await tg(page).calls()).toContain("ready");
    const active = () => page.locator("html").getAttribute("data-app-active");
    expect(await active()).toBe("true");
    await tg(page).setHidden(true);
    await expect.poll(active).toBe("false");
    await tg(page).silentTheme("dark", DARK);
    await tg(page).setViewport(0, true); // нулевая высота без возврата
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim()),
    ).toBe("844px");
    await tg(page).setHidden(false);
    await expect.poll(active).toBe("true");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe("rgb(23, 33, 43)"); // тема перечитана по visibilitychange
    await expect(page.getByTestId("today-title")).toBeVisible();
  });
  test("отказ хранилища после сна (WebKit): экран восстанавливается без перезагрузки на том же разделе, повторный сбой даёт экран с перезапуском", async ({
    page,
  }) => {
    await openTelegram(page, { noCloud: true });
    await installLessons(page, ["lesson-1-1"]);
    const alive = () => page.evaluate(() => (window as unknown as { __alive?: boolean }).__alive === true);
    const reopened = () => page.evaluate(() => (window as unknown as { __reopened?: number }).__reopened ?? 0);
    await page.evaluate(() => {
      (window as unknown as { __alive: boolean }).__alive = true;
    });
    await breakStorage(page);
    await tg(page).deactivate();
    await tg(page).activate(844);
    await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click(); // новый экран читает базу и получает UnknownError
    await expect(page.getByTestId("storage-scope")).toBeVisible(); // экран «Ещё» отрисован после переоткрытия базы
    await expect(page).toHaveURL(/\/more$/); // маршрут не потерян
    expect(await alive()).toBe(true); // страница не перезагружалась
    expect(await reopened()).toBe(1);
    await expect(page.getByTestId("recovery-failed")).toHaveCount(0);
    // Отказ навсегда: экран открыт заранее, чтобы момент падения задавал тест, а не гонка фоновых запросов.
    await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
    await expect(page.getByRole("heading", { name: "Слова" })).toBeVisible();
    await breakStorage(page, true);
    // Любое чтение базы теперь падает: экран доходит до предела попыток сам, ввод в поиск — лишь подстраховка.
    await page
      .getByRole("searchbox")
      .fill("σπι", { timeout: 5000 })
      .catch(() => undefined);
    await expect(page.getByTestId("recovery-failed")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("recovery-failed")).toContainText("Данные на устройстве сохранены");
    expect(await reopened()).toBe(3); // предел три попытки за минуту: первое восстановление уже в счёте
    await page.getByRole("button", { name: "Перезапустить" }).click();
    await expect(page.getByRole("heading", { name: "Слова" })).toBeVisible(); // перезапуск на том же разделе
    expect(await alive()).toBe(false);
  });
});

test.describe("аудио, копии и облако", () => {
  test("отказ воспроизведения: повтор или продолжение без аудирования, без события и штрафа", async ({ page }) => {
    await openTelegram(page, { failAudio: true, noCloud: true });
    await installLessons(page, ["lesson-1-1"]);
    await onlyReviews(page);
    await seedQueue(
      page,
      [{ wordId: "w11-01", tested: ["recall", "recognition", "assembly", "assembly", "spelling"], audio: true }],
      TG_DB,
    );
    await page.getByRole("button", { name: /Начать занятие/ }).click();
    await page.waitForURL("**/session");
    await expect(page.getByTestId("prompt").first()).toHaveText("Что прозвучало?");
    await expect(page.getByTestId("audio-failed")).toBeVisible();
    await page.getByTestId("audio-failed").getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(page.getByTestId("audio-failed")).toBeVisible();
    await page.getByRole("button", { name: "Продолжить без аудио" }).click();
    await expect(
      page
        .getByRole("heading", { name: "Занятие завершено" })
        .or(page.getByTestId("today-title"))
        .or(page.getByTestId("prompt").first()),
    ).toBeVisible();
    const events = await page.evaluate(async () => {
      const request = indexedDB.open("lexi-tg-TaveloriBot-1001");
      const database = await new Promise<IDBDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      const all = database.transaction("events").objectStore("events").getAllKeys();
      return new Promise<number>((resolve) => {
        all.onsuccess = () => resolve((all.result as string[]).filter((key) => String(key).startsWith("e-")).length);
      });
    });
    expect(events).toBe(0); // пропуск не создал события; подготовленная история не в счёт
    expect((await tg(page).calls()).filter((call) => call.startsWith("haptic:"))).toHaveLength(0);
  });
  test("копия: границы синхронизации, нейтральный статус передачи, отмена защитной копии останавливает замену", async ({
    page,
    browser,
  }) => {
    await openTelegram(page);
    await installLessons(page, ["lesson-1-2"]);
    await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
    // Подписанный курс догружается фоном: копию снимаем с устоявшегося словаря и с ним же сверяем перенос.
    await expect(page.getByTestId("word-count")).toHaveText("Показано 50 слов, есть ещё");
    const source = await page.getByTestId("word-count").innerText();
    await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
    await expect(page.getByTestId("storage-scope")).toContainText("Telegram: облачная синхронизация");
    await page.getByRole("link", { name: /Копия данных/ }).click();
    await expect(page.getByTestId("sync-boundaries")).toContainText("Обычный браузер в эту синхронизацию не входит");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Сохранить полную копию" }).click(),
    ]);
    await expect(page.getByTestId("transfer-status")).toContainText("передан браузеру");
    await expect(page.getByTestId("transfer-status")).not.toContainText("сохранена");
    const path = await download.path();
    // Отмена share защитной копии: замена не начинается, данные не меняются.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.reject(Object.assign(new Error("cancel"), { name: "AbortError" })),
      });
    });
    await page.locator("#backup").setInputFiles(path!);
    await expect(page.getByText(/Файл проверен/)).toBeVisible();
    await page.getByRole("button", { name: "Заменить данные копией" }).click();
    await page.getByRole("button", { name: "Заменить", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Замена отменена");
    await expect(page.getByText("Данные восстановлены полностью.")).toHaveCount(0);
    // Файл из Telegram-профиля восстанавливается в чистом браузерном профиле обычным способом.
    const clean = await browser.newContext();
    const web = await clean.newPage();
    await web.goto("/");
    await web.waitForSelector("[data-testid=today-title]");
    await web.goto("/more/backup");
    await web.locator("#backup").setInputFiles(path!);
    await expect(web.getByText(/Файл проверен: база «lexi-tg-TaveloriBot-1001»/)).toBeVisible();
    await web.getByRole("button", { name: "Заменить данные копией" }).click();
    await Promise.all([
      web.waitForEvent("download"),
      web.getByRole("button", { name: "Заменить", exact: true }).click(),
    ]);
    await expect(web.getByText("Данные восстановлены полностью.")).toBeVisible();
    await web.goto("/words");
    await expect(web.getByTestId("word-count")).toHaveText(source);
    await clean.close();
  });
  test("CloudStorage: статус синхронизации, перенос прогресса второму устройству, изоляция другого аккаунта", async ({
    page,
    browser,
  }) => {
    await openTelegram(page);
    await installLessons(page, ["lesson-1-1"]);
    await onlyReviews(page);
    await seedQueue(
      page,
      [
        { wordId: "w11-01", tested: ["recall"] },
        { wordId: "w11-02", tested: ["recall"] },
      ],
      TG_DB,
    );
    await page.getByRole("button", { name: /Начать занятие/ }).click();
    await page.waitForURL("**/session");
    await page.getByTestId("option").and(page.locator(":not([disabled])")).first().click();
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page.goto("/more");
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-phase", "synced", { timeout: 15000 });
    await expect(page.getByTestId("sync-status")).toContainText("Синхронизировано");
    const cloud = await tg(page).cloud();
    expect(Object.keys(cloud).some((key) => key.startsWith("p_"))).toBe(true);
    expect(Object.values(cloud).every((value) => value.length <= 4096)).toBe(true);
    // Второе устройство того же аккаунта получает состояния; пакет догружается из каталога.
    const second = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const tablet = await second.newPage();
    await openTelegram(tablet, { cloud, platform: "android" });
    await tablet.goto("/more");
    await expect(tablet.getByTestId("sync-status")).toHaveAttribute("data-phase", "synced", { timeout: 15000 });
    await expect
      .poll(
        () =>
          tablet.evaluate(async () => {
            const request = indexedDB.open("lexi-tg-TaveloriBot-1001");
            const database = await new Promise<IDBDatabase>((resolve) => {
              request.onsuccess = () => resolve(request.result);
            });
            const count = database.transaction("cardStates").objectStore("cardStates").count();
            return new Promise<number>((resolve) => {
              count.onsuccess = () => resolve(count.result);
            });
          }),
        { timeout: 20000 },
      )
      .toBe(2);
    await tablet.goto("/lessons");
    // Пакет догружен из каталога: строка урока, а не строка «не загружен».
    await expect(tablet.getByRole("link", { name: /^1\.1 · (?!не загружен)/ })).toBeVisible();
    await second.close();
    // Другой аккаунт на том же устройстве: пустой профиль, чужие данные не показываются и не уходят в его облако.
    const third = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const other = await third.newPage();
    await openTelegram(other, { userId: 2002 });
    await other.goto("/words");
    await expect(other.getByTestId("word-count")).toHaveText("0 слов");
    await other.goto("/more");
    await expect(other.getByTestId("sync-status")).toHaveAttribute("data-phase", /synced|idle/, { timeout: 15000 });
    const otherCloud = await tg(other).cloud();
    expect(Object.keys(otherCloud)).toHaveLength(0);
    await third.close();
  });
  test("без CloudStorage в старом клиенте тренировка работает, синхронизация приостановлена без ложного успеха", async ({
    page,
  }) => {
    await openTelegram(page, { noCloud: true, version: "6.0" });
    await installLessons(page, ["lesson-1-1"]);
    await page.goto("/more");
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-phase", "disabled");
    await expect(page.getByTestId("sync-status")).not.toContainText("Синхронизировано");
    await page.goto("/lessons/lesson-1-1");
    await expect(page.getByRole("button", { name: "Назад" })).toBeVisible(); // BackButton требует 6.1 — внутренняя остаётся
  });
});

test.describe("ссылка на слово через бота", () => {
  const DEV_DB = "lexi-tg-TaveloriDevBot-1001";
  const launch = async (
    page: import("@playwright/test").Page,
    options: import("./telegram").TelegramEmulation,
    path = "/",
  ) => {
    const { launchHash } = await import("./telegram");
    await page.goto(`${path}?bot=TaveloriDevBot${launchHash(options)}`);
  };
  const dismissWelcome = async (page: import("@playwright/test").Page) => {
    const welcome = page.getByRole("button", { name: /Понятно|Начать с чистого профиля/ });
    if (
      await welcome.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      await welcome.click();
      await page.getByRole("alertdialog").waitFor({ state: "hidden" });
    }
  };
  const databases = (page: import("@playwright/test").Page) =>
    page.evaluate(async () => (await indexedDB.databases()).map((info) => info.name ?? ""));

  test("dev-запуск открывает слово, после перезагрузки «Поделиться» ведёт на dev-бота, профиль прежний", async ({
    page,
  }) => {
    const { bridgeScript } = await import("./telegram");
    await page.addInitScript(bridgeScript({ noCloud: true }));
    await launch(page, { startParam: "w_w34-03", queryId: "Q1" });
    await dismissWelcome(page);
    await expect(page).toHaveURL(/\/share\/word\/w34-03$/);
    await expect(page.getByText("η κατσαρόλα", { exact: true }).first()).toBeVisible();
    // Урок ставится только из раздела «Уроки»; после этого у слова курса появляется кнопка.
    await page.goto("/lessons/lesson-3-4");
    await page.getByRole("heading", { name: /^Слова · \d+$/ }).waitFor({ timeout: 20000 });
    await page.goto("/words/w34-03");
    await page.reload();
    await page.getByRole("button", { name: "Поделиться словом" }).click();
    const link = (await tg(page).calls()).find((call) => call.startsWith("link:"))!;
    const target = new URL(link.slice(5));
    expect(target.searchParams.get("url")).toBe("https://t.me/TaveloriDevBot?startapp=w_w34-03");
    expect(target.searchParams.get("text")).toBe("η κατσαρόλα — кастрюля");
    const names = await databases(page);
    expect(names).toContain(DEV_DB);
    expect(names).not.toContain(TG_DB);
  });

  test("с query_id перезагрузка остаётся на экране, новый запуск в той же вкладке открывает новое слово", async ({
    page,
  }) => {
    const { bridgeScript } = await import("./telegram");
    await page.addInitScript(bridgeScript({ noCloud: true }));
    await launch(page, { startParam: "w_w34-03", queryId: "Q1" });
    await dismissWelcome(page);
    await expect(page.getByText("η κατσαρόλα", { exact: true }).first()).toBeVisible();
    await page.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();
    await expect(page).toHaveURL(/\/lessons$/);
    await page.reload();
    await expect(page.getByRole("link", { name: /1\.2/ })).toBeVisible();
    await expect(page).toHaveURL(/\/lessons$/);
    await launch(page, { startParam: "w_w12-01", queryId: "Q2" }, "/more");
    await expect(page).toHaveURL(/\/share\/word\/w12-01$/);
    await expect(page.getByText("το φως", { exact: true }).first()).toBeVisible();
  });
});
