import { expect, test } from "@playwright/test";
import { installLessons, lessonCards, ready, seedQueue, useSchedule } from "./helpers";
import { addDays } from "../../src/domain/learning";
import { isoWeekday } from "../../src/domain/schedule";
import { dativeWeekday, dayMonth } from "../../src/shared/format";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-1", "lesson-1-2", "lesson-1-3", "lesson-1-4"]);
});

test("оболочка открывается, разделы доступны с клавиатуры", async ({ page }) => {
  await useSchedule(page);
  await expect(page.getByTestId("today-title")).toBeVisible();
  await expect(page.getByText("Урок 1.2")).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await expect(page.getByRole("heading", { name: "Слова" })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();
  await expect(page.getByRole("link", { name: /1\.1/ })).toBeVisible();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(["A", "BUTTON", "INPUT", "SELECT"]).toContain(focused);
});

test("хвост пройденного урока виден на «Сегодня», но занятие готовит к ближайшему уроку", async ({ page }) => {
  await useSchedule(page); // урок 1.1 закрепляется проведённым, 1.2 становится ближайшим
  await expect(page.getByTestId("backlog")).toContainText("ещё не показаны");
  // Часть слов урока 1.1 повторяется в уроках со сроком: они готовятся к сроку, а не висят в хвосте.
  const cards = await lessonCards(page);
  // Любой более поздний урок, а не только 1.2-1.4: слово 1.1 может повториться и в наборе третьего уровня.
  const upcoming = new Set(
    Object.entries(cards)
      .filter(([id]) => id !== "lesson-1-1")
      .flatMap(([, keys]) => keys),
  );
  const tail = cards["lesson-1-1"].filter((key) => !upcoming.has(key)).length;
  expect(tail).toBeLessThan(cards["lesson-1-1"].length);
  await expect(page.getByTestId("backlog")).toContainText(String(tail));
  await expect(page.getByTestId("backlog")).toContainText("из 1 занятия");
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await page.waitForURL("**/session");
  await expect(page.getByTestId("lesson-label")).toHaveText("К уроку 1.2");
  const counts = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("lexi");
      request.onsuccess = () => resolve(request.result);
    });
    const session = await new Promise<{ items: { unitKey: string }[] }>((resolve) => {
      const all = database.transaction("sessions").objectStore("sessions").getAll();
      all.onsuccess = () =>
        resolve(
          (all.result as { items: { unitKey: string }[]; status: string }[]).find((item) => item.status === "active")!,
        );
    });
    const links = await new Promise<{ lessonId: string; unitKey: string }[]>((resolve) => {
      const all = database.transaction("lessonItems").objectStore("lessonItems").getAll();
      all.onsuccess = () => resolve(all.result as { lessonId: string; unitKey: string }[]);
    });
    database.close();
    const count = (lessonId: string) => {
      const own = new Set(links.filter((link) => link.lessonId === lessonId).map((link) => link.unitKey));
      return session.items.filter((item) => own.has(item.unitKey)).length;
    };
    return { past: count("lesson-1-1"), next: count("lesson-1-2") };
  });
  expect(counts.next).toBeGreaterThan(0);
  expect(counts.past).toBe(0);
});

test("исходные уроки, карточка слова и ручная тренировка", async ({ page }) => {
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await page.getByRole("searchbox").fill("σπίτι");
  await page.getByRole("link", { name: /το σπίτι/ }).click();
  await expect(page.getByText("/to ˈspiti/")).toBeVisible();
  await expect(page.getByText("Ударение на первый слог")).toBeVisible();
  await expect(page.getByText("Το σπίτι μας είναι μεγάλο.")).toBeVisible();
  await expect(page.getByTestId("word-art")).toBeVisible();
  await page.getByRole("button", { name: "Потренировать слово" }).click();
  await expect(page.getByText("Новое слово")).toBeVisible();
});

test("занятие: знакомство, четыре упражнения, результат и продолжение после перезапуска", async ({ page }) => {
  await useSchedule(page);
  await seedQueue(page, [
    { wordId: "w11-01", tested: ["recall"] },
    { wordId: "w11-02", tested: ["recall", "recognition"] },
    { wordId: "w11-03", tested: ["recall", "recognition", "assembly", "assembly"], audio: false },
    { wordId: "w11-04", tested: ["recall", "recognition", "assembly", "assembly", "spelling"], audio: true },
  ]);
  await page.getByRole("button", { name: /Начать занятие/ }).click();
  await page.waitForURL("**/session");
  const seen = new Set<string>();
  let completed = 0;
  for (let step = 0; step < 80; step++) {
    if (await page.getByRole("heading", { name: "Занятие завершено" }).isVisible()) break;
    const prompt = await page.getByTestId("prompt").first().innerText();
    const next = page.getByRole("button", { name: "Далее", exact: true });
    if (prompt === "Новое слово") {
      seen.add("intro");
    } else {
      await expect(page.getByTestId("grade")).toHaveCount(0);
      if (prompt === "Что значит это слово?" || prompt === "Что прозвучало?") {
        seen.add(prompt === "Что значит это слово?" ? "recognition" : "listening");
        await page.getByTestId("option").and(page.locator(":not([disabled])")).first().click();
      } else if (prompt === "Собери слово") {
        seen.add("assembly");
        for (const tile of await page.getByTestId("tile").all()) await tile.click();
        await page.getByRole("button", { name: "Проверить" }).click();
      } else if (prompt === "Напиши по-гречески") {
        seen.add("spelling");
        await page.getByLabel("Твой ответ по-гречески").fill("λάθος");
        await page.getByRole("button", { name: "Проверить" }).click();
        await expect(page.getByTestId("chars")).toBeVisible();
      } else throw new Error(`Неожиданное задание: ${prompt}`);
      await expect(page.getByTestId("feedback").or(page.locator('[data-answer="correct"]'))).toBeVisible();
      if (++completed === 3) {
        await page.goto("/");
        await ready(page);
        await page.getByRole("button", { name: /Продолжить занятие/ }).click();
        await page.waitForURL("**/session");
        continue;
      }
    }
    const counter = page.getByLabel(/^(Знакомство|Упражнение) \d+ из \d+$/);
    const previous = await counter.getAttribute("aria-label");
    await next.click();
    await expect(page.getByLabel(previous!, { exact: true })).toHaveCount(0);
  }
  expect([...seen].sort()).toEqual(["assembly", "intro", "listening", "recognition", "spelling"]);
  await expect(page.getByRole("heading", { name: "Занятие завершено" })).toBeVisible();
  await expect(page.getByText(/Объективная точность/)).toBeVisible();
  await expect(page.getByText(/Активное время/)).toBeVisible();
  // Активное время копится по всем упражнениям и переживает возврат в занятие.
  const activeMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("lexi");
        request.onsuccess = () => {
          const rows = request.result.transaction("sessions", "readonly").objectStore("sessions").getAll();
          rows.onsuccess = () =>
            resolve(Math.max(0, ...rows.result.map((session: { activeTimeMs: number }) => session.activeTimeMs)));
        };
      }),
  );
  expect(activeMs).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Готово" }).click();
  await ready(page);
  await page.reload();
  await ready(page);
  await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
  await page.getByRole("link", { name: /Статистика/ }).click();
  const recorded = await page.getByText(/Всего записано/).innerText();
  expect(recorded).not.toContain("Всего записано 0");
  // Новые слова занятия были из урока 1.2: его строка прогресса больше не «30 новых».
  await page.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();
  await expect(page.getByRole("link", { name: /1\.2 ·/ })).toContainText("в повторении");
  await expect(page.getByRole("link", { name: /1\.2 ·/ })).not.toContainText("30 новых");
});

test("прогресс урока виден на «Сегодня» и «Уроках» и меняется вслед за состояниями слов", async ({ page }) => {
  await useSchedule(page);
  const row = () => page.getByRole("link", { name: /1\.1 ·/ });
  const lessons = () => page.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();
  const size = (await lessonCards(page))["lesson-1-1"].length;
  await expect(row().getByTestId("lesson-progress")).toHaveText(`${size} новых`);
  await expect(row().getByRole("img", { name: `Освоено 0% · ${size} новых`, exact: true })).toBeVisible();
  await lessons();
  await expect(row().getByTestId("lesson-progress")).toHaveText(`${size} новых`);
  await expect(row()).toContainText("проведён");
  await page.getByRole("navigation").getByRole("link", { name: "Сегодня" }).click(); // засев перезагружает страницу и ждёт «Сегодня»
  await seedQueue(page, [
    { wordId: "w11-01", tested: ["recall"] },
    { wordId: "w11-02", tested: [] },
    { wordId: "w11-03", tested: [] },
    { wordId: "w11-04", tested: [] },
  ]);
  await expect(row().getByTestId("lesson-progress")).toHaveText(`4 в повторении · ${size - 4} новых`);
  // Четыре слова с двухдневным интервалом на весь урок — полоса едва тронута, а не полна.
  await expect(
    row().getByRole("img", { name: new RegExp(`^Освоено [0-5]% · 4 в повторении · ${size - 4} новых$`) }),
  ).toBeVisible();
  await lessons();
  await expect(row().getByTestId("lesson-progress")).toHaveText(`4 в повторении · ${size - 4} новых`);
  // Пустой набор: число слов есть, полосы нет.
  await page.getByRole("button", { name: "Добавить занятие" }).click();
  await page.locator("#title").fill("Урок 9.9");
  await page.getByRole("button", { name: "Создать" }).click();
  const fresh = page.getByRole("link", { name: /9\.9 ·/ });
  await expect(fresh).toContainText("0 слов");
  await expect(fresh.getByTestId("lesson-progress")).toHaveCount(0);
});

test("будущие занятия: импорт нового набора без даты, дата на экране урока и пересчёт плана", async ({ page }) => {
  await useSchedule(page);
  await page.getByRole("navigation").getByRole("link", { name: "Ещё" }).click();
  await page.getByRole("link", { name: /Импорт слов/ }).click();
  await page.locator("#text").fill("το τραπέζι\nстол\nη καρέκλα\nстул\nτο σπίτι\nдом");
  await expect(page.getByText(/распознано 3 слова/)).toBeVisible();
  await expect(page.getByText(/уже есть в словаре/)).toBeVisible();
  await expect(page.locator("#date")).toHaveCount(0); // дату назначает расписание
  await page.locator("#title").fill("Урок 1.5");
  await page.getByRole("button", { name: /Сохранить 3 слова/ }).click();
  await expect(page.getByRole("heading", { name: "Урок 1.5" })).toBeVisible();
  await expect(page.getByText(/3 слова/)).toBeVisible();
  await expect(page.getByText("Дата не назначена")).toBeVisible();
  // Дата заведомо дальше всех уроков расписания: ближайшим остаётся 1.2. Фиксированная дата здесь была миной — она наступила.
  await page.locator("#date").fill(addDays(new Date().toISOString().slice(0, 10), 30));
  await page.getByRole("button", { name: "Сохранить дату" }).click();
  await expect(page.getByText(/План пересчитан|Дата сохранена/)).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Сегодня" }).click();
  await expect(page.getByText("Урок 1.2")).toBeVisible();
});

test("расписание: даты уроков 1.3 и 1.4, ручной перенос сдвигает хвост, возврат в расписание", async ({ page }) => {
  // Первое занятие — урок 1.1 — не раньше сегодня, поэтому проверка не зависит от календаря.
  const today = new Date().toISOString().slice(0, 10);
  const start = addDays(today, 2);
  const days = [isoWeekday(start), isoWeekday(addDays(start, 3))];
  const SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  // Предлог с днём недели получает только ближайшее занятие курса, остальным хватает даты.
  const nextAt = (number: string, day: string) =>
    page.getByRole("link", { name: new RegExp(`${number} · К ${dativeWeekday(day)}, ${dayMonth(day)}`) });
  const lessonAt = (number: string, day: string) =>
    page.getByRole("link", { name: new RegExp(`${number} · ${dayMonth(day)}`) });
  const lessons = () => page.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();

  await lessons();
  await expect(page.getByText("Не задано — даты уроков назначаются вручную")).toBeVisible();
  await expect(page.getByRole("link", { name: /1\.3 · Без даты/ })).toBeVisible();
  await page.getByRole("button", { name: "Задать расписание" }).click();
  await page.locator("#start").fill(start);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Выберите хотя бы один день недели.")).toBeVisible();
  for (const day of days) {
    const toggle = page.getByRole("button", { name: SHORT[day - 1], exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Сохранить" }).click();
  const named = [...days].sort((a, b) => a - b).map((day) => SHORT[day - 1]);
  await expect(page.getByText(`${named[0]} и ${named[1]}, первое занятие ${dayMonth(start)}`)).toBeVisible();
  // Ни у одного урока нет своей даты: все четыре получают дни расписания по порядку номеров.
  await expect(nextAt("1\\.1", start)).toBeVisible();
  await expect(lessonAt("1\\.2", addDays(start, 3))).toBeVisible();
  await expect(lessonAt("1\\.3", addDays(start, 7))).toBeVisible();
  await expect(lessonAt("1\\.4", addDays(start, 10))).toBeVisible();
  await expect(page.getByRole("link", { name: /1\.3 ·/ })).not.toContainText("дата вручную");

  await lessonAt("1\\.3", addDays(start, 7)).click();
  await expect(page.locator("#date")).toHaveValue(addDays(start, 7));
  await expect(page.getByText("Дата по расписанию. Своя дата сдвинет следующие уроки.")).toBeVisible();
  await page.locator("#date").fill(addDays(start, 10));
  await page.getByRole("button", { name: "Сохранить дату" }).click();
  await expect(page.getByText(/Дата сохранена/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Вернуть в расписание" })).toBeVisible();
  await lessons();
  await expect(lessonAt("1\\.3", addDays(start, 10))).toContainText("дата вручную");
  await expect(lessonAt("1\\.4", addDays(start, 14))).toBeVisible();

  await lessonAt("1\\.3", addDays(start, 10)).click();
  await page.getByRole("button", { name: "Вернуть в расписание" }).click();
  await expect(page.locator("#date")).toHaveValue(addDays(start, 7));
  await expect(page.getByText("Дата по расписанию. Своя дата сдвинет следующие уроки.")).toBeVisible();
  await lessons();
  await expect(lessonAt("1\\.3", addDays(start, 7))).toBeVisible();
  await expect(lessonAt("1\\.4", addDays(start, 10))).toBeVisible();

  // «Сегодня» показывает ближайшее занятие панелью со сроком; дальние уроки живут на «Уроках».
  await page.getByRole("navigation").getByRole("link", { name: "Сегодня" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByTestId("today-title")).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(`К ${dativeWeekday(start)}, ${dayMonth(start)}.*1\\.1`) }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /1\.3 ·/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Все уроки · \d+$/ })).toBeVisible();

  await lessons();
  await page.getByRole("button", { name: "Изменить расписание" }).click();
  await page.getByRole("button", { name: "Убрать расписание" }).click();
  await expect(page.getByText("Не задано — даты уроков назначаются вручную")).toBeVisible();
  await expect(page.getByRole("link", { name: /1\.3 · Без даты/ })).toBeVisible();
});

test("расписание с первым занятием в прошлом сразу закрепляет прошедшие уроки", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const start = addDays(today, -14);
  const days = [isoWeekday(start), isoWeekday(addDays(start, 3))];
  const SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const lessons = () => page.getByRole("navigation").getByRole("link", { name: "Уроки" }).click();

  await page.goto("/");
  await lessons();
  await page.getByRole("button", { name: "Задать расписание" }).click();
  await expect(page.locator("#start")).not.toHaveAttribute("min");
  await page.locator("#start").fill(start);
  await expect(page.getByText("Дата в прошлом: уроки, чьи дни уже прошли, будут отмечены проведёнными.")).toBeVisible();
  for (const day of days) await page.getByRole("button", { name: SHORT[day - 1], exact: true }).click();
  await page.getByRole("button", { name: "Сохранить" }).click();
  for (const [number, day] of [
    ["1\\.1", start],
    ["1\\.2", addDays(start, 3)],
    ["1\\.3", addDays(start, 7)],
    ["1\\.4", addDays(start, 10)],
  ] as const) {
    const item = page.getByRole("link", { name: new RegExp(`${number} · ${dayMonth(day)}`) });
    await expect(item).toContainText("проведён");
  }
  await expect(page.getByRole("link", { name: /1\.2 ·/ })).not.toContainText("предстоит");
});
