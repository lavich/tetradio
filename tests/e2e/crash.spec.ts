import { expect, test } from "@playwright/test";
import { breakStorage, installLessons, ready } from "./helpers";

/** Тестовая сборка идёт без адреса приёма: ни один сценарий, включая сбои, не должен обращаться к сервису отчётов и грузить его чанк. */
const external: string[] = [];
test.beforeEach(({ page }) => {
  page.on("request", (request) => {
    const url = request.url();
    if (/sentry|\/assets\/sentry-/.test(url)) external.push(url);
  });
});
test.afterEach(() => {
  expect(external).toEqual([]);
});

test("база не открывается при запуске: вместо пустой страницы — понятное сообщение с перезапуском и диагностикой", async ({
  page,
}) => {
  // Хранилище недоступно с первого обращения, как в приватном режиме WebKit или при повреждённом профиле.
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException("The user denied permission to access the database.", "SecurityError");
    };
  });
  await page.goto("/");
  const screen = page.getByTestId("storage-failed");
  await expect(screen).toBeVisible({ timeout: 15000 });
  await expect(screen).toContainText("Не удалось открыть данные");
  await expect(screen.getByRole("button", { name: "Перезапустить" })).toBeVisible();
  await expect(screen.getByRole("button", { name: "Скопировать диагностику" })).toBeVisible();
  await expect(page.getByTestId("today-title")).toHaveCount(0);
});

test("падение во время занятия: экран сбоя с перезапуском, после перезапуска «Сегодня» предлагает продолжить занятие", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await installLessons(page, ["lesson-1-1", "lesson-1-2", "lesson-1-3", "lesson-1-4"]);
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await page.waitForURL("**/session");
  await expect(page.getByTestId("lesson-label")).toBeVisible();
  // Хранилище отказывает навсегда: чтение при рендере бросает исключение, три переоткрытия не помогают.
  // Экран занятия обычно падает сам на живом запросе; иначе его валит возврат на «Сегодня» историей —
  // без «Закрыть занятие», которое штатно завершило бы занятие записью.
  await breakStorage(page, true);
  const crash = page.getByTestId("recovery-failed");
  if (!(await crash.isVisible())) await page.goBack();
  await expect(crash).toBeVisible({ timeout: 15000 });
  await expect(crash).toContainText("Данные на устройстве сохранены");
  await expect(crash.getByRole("button", { name: "Скопировать диагностику" })).toBeVisible();
  await crash.getByRole("button", { name: "Перезапустить" }).click();
  await page.waitForLoadState("domcontentloaded");
  // Граница ошибок в базу не писала: занятие осталось активным, и «Сегодня» предлагает продолжить его.
  await page.goto("/");
  await ready(page);
  await expect(page.getByRole("button", { name: "Продолжить занятие" })).toBeVisible();
});
