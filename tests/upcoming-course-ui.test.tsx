// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { CourseScreen } from "../src/features/course/ShelfScreen";
import { forgetWaitlistStatus } from "../src/features/course/UpcomingCourse";
import { db, type StoredCatalogEntry } from "../src/storage/db";
import { chooseShelfCourse, primaryCourse, rememberCourses, UPCOMING_KEY } from "../src/storage/courses";

const bot = vi.hoisted(() => ({
  available: true,
  granted: [] as boolean[],
  answers: [] as ({ result: string; joined?: boolean } | Promise<{ result: string; joined?: boolean }>)[],
  calls: [] as string[],
}));
vi.mock("../src/platform/feedback", async (original) => ({
  ...(await original<typeof import("../src/platform/feedback")>()),
  formAvailable: () => bot.available,
}));
vi.mock("../src/platform/platform", async (original) => ({
  ...(await original<typeof import("../src/platform/platform")>()),
  telegramBridge: () => ({}),
}));
vi.mock("../src/platform/feedback-send", async (original) => ({
  ...(await original<typeof import("../src/platform/feedback-send")>()),
  askWriteAccess: async (_app: unknown, _timeout: unknown, again: boolean) => {
    bot.calls.push(again ? "ask-again" : "ask");
    return bot.granted.shift() ?? true;
  },
  waitlist: async (action: string) => {
    bot.calls.push(action);
    return (await bot.answers.shift()) ?? { result: "failed" };
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
Element.prototype.scrollIntoView = vi.fn();

const iso = "2026-10-27T09:00:00.000Z";
const entry: StoredCatalogEntry = {
  id: "greek-a2-1",
  courseId: "greek-a2",
  language: "el",
  title: "Урок",
  wordCount: 0,
  phraseCount: 0,
  cardCount: 0,
  version: "1",
  url: "",
  bytes: 0,
  media: { count: 0, bytes: 0 },
  position: 0,
};
const b1 = { id: "greek-b1", title: "Греческий", language: "el", level: "A2 → B1", after: "greek-a2" };

let root: Root | null = null;
let host: HTMLElement;
const mount = (state?: { course: string }) => {
  const router = createMemoryRouter([{ path: "/course", element: <CourseScreen /> }], {
    initialEntries: [{ pathname: "/course", state }],
  });
  root = createRoot(host);
  root.render(<RouterProvider router={router} />);
};
const settled = (check: () => void) => vi.waitFor(check, 5000);
const options = () =>
  [...host.querySelectorAll<HTMLButtonElement>('[data-testid="course-switch"] [role="radio"]')].map((option) => ({
    text: option.textContent,
    label: option.getAttribute("aria-label"),
    checked: option.getAttribute("aria-checked") === "true",
  }));
const page = () => host.querySelector('[data-testid="upcoming-course"]');
const button = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(name));
const start = async () => {
  await db.lessons.add({ id: "greek-a2-1", courseId: "greek-a2", title: "x", completed: false, updatedAt: iso });
  await rememberCourses(db);
};

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.courses.add({ id: "greek-a2", title: "Греческий", level: "A0 → A2", short: "Греческий", updatedAt: iso });
  await db.catalog.add(entry);
  await db.meta.put({ key: UPCOMING_KEY, value: JSON.stringify([b1]) });
  Object.assign(bot, { available: true, granted: [], answers: [], calls: [] });
  forgetWaitlistStatus();
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

describe("переключатель с курсом в работе", () => {
  it("подписи — уровни, у курса в работе нет «+», читалка слышит «готовится»", async () => {
    await start();
    mount();
    await settled(() =>
      expect(options()).toEqual([
        { text: "A0 → A2", label: null, checked: true },
        { text: "A2 → B1", label: "A2 → B1, готовится", checked: false },
      ]),
    );
  });

  it("новый человек: «+ A0 → A2 | A2 → B1»", async () => {
    mount();
    await settled(() => expect(options().map((option) => option.text)).toEqual(["+ A0 → A2", "A2 → B1"]));
  });

  it("курс в работе другого языка не меняет подписи английских курсов", async () => {
    await db.courses.bulkAdd([
      {
        id: "english-it",
        title: "Английский для IT",
        short: "Для IT",
        level: "B1 → B2",
        language: "en",
        updatedAt: iso,
      },
      { id: "english-travel", title: "Для путешествий", short: "Для путешествий", language: "en", updatedAt: iso },
    ]);
    await db.catalog.bulkAdd([
      { ...entry, id: "english-it-1", courseId: "english-it", language: "en", position: 1 },
      { ...entry, id: "english-travel-1", courseId: "english-travel", language: "en", position: 2 },
    ]);
    await db.lessons.add({ id: "english-it-1", courseId: "english-it", title: "x", completed: false, updatedAt: iso });
    await rememberCourses(db);
    await chooseShelfCourse("english-it", db);
    mount();
    await settled(() => expect(options().map((option) => option.text)).toEqual(["Для IT", "+ Для путешествий"]));
  });

  it("без курса в работе переключателя нет", async () => {
    await db.meta.delete(UPCOMING_KEY);
    await start();
    mount();
    await settled(() => expect(host.querySelector("h1")).not.toBeNull());
    expect(options()).toEqual([]);
  });
});

describe("страница курса в работе", () => {
  const openB1 = async (answers: { result: string; joined?: boolean }[]) => {
    await start();
    const primary = await primaryCourse(db);
    await chooseShelfCourse("greek-b1", db);
    bot.answers.push(...answers);
    mount();
    await settled(() => expect(page()).not.toBeNull());
    return primary;
  };

  it("текст, обложка и запись → «Вы в списке» → отмена", async () => {
    const primary = await openB1([
      { result: "ok", joined: false },
      { result: "ok", joined: true },
      { result: "ok", joined: false },
    ]);
    expect(page()!.querySelector("h2")!.textContent).toBe("Греческий · A2 → B1");
    expect(page()!.textContent).toContain("Следующая ступень после A0 → A2. Курс ещё пишется, уроков пока нет.");
    expect(page()!.textContent).toContain("B1Готовится");
    await settled(() => expect(button("Сообщить, когда выйдет")!.getAttribute("aria-disabled")).toBeNull());
    button("Сообщить, когда выйдет")!.click();
    await settled(() => expect(host.textContent).toContain("Вы в списке"));
    expect(host.textContent).toContain("Напишем в чат с ботом, когда откроется первый модуль.");
    button("Отменить заявку")!.click();
    await settled(() => expect(button("Сообщить, когда выйдет")).toBeDefined());
    expect(bot.calls).toEqual(["status", "ask-again", "join", "leave"]);
    expect(await primaryCourse(db)).toBe(primary);
  });

  it("пока статус не пришёл, кнопка недоступна; сбой проверки — текст и «Повторить»", async () => {
    await openB1([{ result: "failed" }, { result: "ok", joined: true }]);
    await settled(() => expect(host.textContent).toContain("Не удалось проверить заявку."));
    expect(button("Сообщить, когда выйдет")!.getAttribute("aria-disabled")).toBe("true");
    button("Повторить")!.click();
    await settled(() => expect(host.textContent).toContain("Вы в списке"));
  });

  it.each([
    [{ result: "failed" }, "Не удалось отправить заявку. Попробуйте позже."],
    [{ result: "stale" }, "Перезапустите приложение и повторите."],
    [{ result: "rate" }, "Подождите несколько секунд и повторите."],
  ])("сбой записи %o — %s", async (answer, text) => {
    await openB1([{ result: "ok", joined: false }, answer]);
    await settled(() => expect(button("Сообщить, когда выйдет")!.getAttribute("aria-disabled")).toBeNull());
    button("Сообщить, когда выйдет")!.click();
    await settled(() => expect(host.querySelector('[data-testid="waitlist-problem"]')?.textContent).toBe(text));
  });

  it("сбой отмены — свой текст", async () => {
    await openB1([{ result: "ok", joined: true }, { result: "failed" }]);
    await settled(() => expect(button("Отменить заявку")).toBeDefined());
    button("Отменить заявку")!.click();
    await settled(() =>
      expect(host.querySelector('[data-testid="waitlist-problem"]')?.textContent).toBe(
        "Не удалось отменить заявку. Попробуйте позже.",
      ),
    );
  });

  it("отказ в праве писать — запроса нет, «Повторить» спрашивает снова", async () => {
    bot.granted.push(false, true);
    await openB1([
      { result: "ok", joined: false },
      { result: "ok", joined: true },
    ]);
    await settled(() => expect(button("Сообщить, когда выйдет")!.getAttribute("aria-disabled")).toBeNull());
    button("Сообщить, когда выйдет")!.click();
    await settled(() =>
      expect(host.textContent).toContain("Без разрешения писать бот не сможет сообщить о выходе курса."),
    );
    expect(bot.calls).toEqual(["status", "ask-again"]);
    button("Повторить")!.click();
    await settled(() => expect(host.textContent).toContain("Вы в списке"));
    expect(bot.calls).toEqual(["status", "ask-again", "ask-again", "join"]);
  });

  it("вне Telegram — текст вместо кнопки, запросов нет", async () => {
    bot.available = false;
    await openB1([]);
    expect(host.textContent).toContain("Заявку можно оставить в приложении в Telegram.");
    expect(button("Сообщить, когда выйдет")).toBeUndefined();
    expect(bot.calls).toEqual([]);
  });

  it("двойное нажатие «Отменить заявку» — один запрос", async () => {
    await openB1([
      { result: "ok", joined: true },
      { result: "ok", joined: false },
    ]);
    await settled(() => expect(button("Отменить заявку")).toBeDefined());
    button("Отменить заявку")!.click();
    button("Отменить заявку")!.click();
    await settled(() => expect(button("Сообщить, когда выйдет")).toBeDefined());
    expect(bot.calls.filter((call) => call === "leave")).toHaveLength(1);
  });

  it("фокус переходит на кнопку, заменившую нажатую; читалка слышит итог", async () => {
    await openB1([
      { result: "ok", joined: false },
      { result: "ok", joined: true },
      { result: "ok", joined: false },
    ]);
    await settled(() => expect(button("Сообщить, когда выйдет")!.getAttribute("aria-disabled")).toBeNull());
    button("Сообщить, когда выйдет")!.focus();
    button("Сообщить, когда выйдет")!.click();
    await settled(() => expect(document.activeElement?.textContent).toBe("Отменить заявку"));
    expect(page()!.querySelector('[role="status"]')!.textContent).toBe("Вы в списке");
    button("Отменить заявку")!.click();
    await settled(() => expect(document.activeElement?.textContent).toContain("Сообщить, когда выйдет"));
    expect(page()!.querySelector('[role="status"]')!.textContent).toBe("Заявка отменена");
  });

  it("возврат на страницу во время записи показывает её итог", async () => {
    let release: (value: { result: string; joined?: boolean }) => void = () => undefined;
    await openB1([{ result: "ok", joined: false }]);
    await settled(() => expect(button("Сообщить, когда выйдет")!.getAttribute("aria-disabled")).toBeNull());
    bot.answers.push(new Promise((resolve) => (release = resolve)));
    button("Сообщить, когда выйдет")!.click();
    root!.unmount();
    mount();
    await settled(() => expect(page()).not.toBeNull());
    release({ result: "ok", joined: true });
    await settled(() => expect(host.querySelector('[data-testid="waitlist-joined"]')).not.toBeNull());
  });

  it("переход с выбором курса в работе открывает страницу с фокусом на заголовке", async () => {
    await start();
    bot.answers.push({ result: "ok", joined: false });
    mount({ course: "greek-b1" });
    await settled(() => expect(document.activeElement?.textContent).toBe("Греческий · A2 → B1"));
  });
});
