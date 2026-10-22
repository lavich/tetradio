// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { CourseScreen } from "../src/features/course/ShelfScreen";
import { SharedCourseScreen } from "../src/features/course/SharedCourseScreen";
import { resetCatalogPhase, setCatalogPhase } from "../src/content/phases";
import { db } from "../src/storage/db";
import { primaryCourse, shelfLanguage } from "../src/storage/courses";
import { pauseCourse } from "../src/storage/pause-actions";
import { install, seedCatalog } from "./helpers/language-db";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
Element.prototype.scrollIntoView = vi.fn();

let root: Root | null = null;
let host: HTMLElement;
let router: ReturnType<typeof createMemoryRouter>;
let copied: string[];
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  resetCatalogPhase();
  toast.success.mockClear();
  copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

const open = (path: string) => {
  router = createMemoryRouter(
    [
      { path: "/", element: <p data-testid="today">Сегодня</p> },
      { path: "/course", element: <CourseScreen /> },
      { path: "/share/course/:id", element: <SharedCourseScreen /> },
    ],
    { initialEntries: [path] },
  );
  root = createRoot(host);
  root.render(<RouterProvider router={router} />);
};
const at = (pathname: string) => vi.waitFor(() => expect(router.state.location.pathname).toBe(pathname), 5000);
const shelves = () => [...host.querySelectorAll<HTMLElement>('[data-testid="course-shelf"]')];
const offers = () => [...host.querySelectorAll<HTMLElement>('[data-testid="course-offer"]')];
const rows = async () => ({
  lessons: await db.lessons.count(),
  states: await db.cardStates.count(),
  events: await db.events.count(),
  courses: await db.courses.count(),
});

describe("ссылка на курс", () => {
  it("новый пользователь: полка английского, карточка курса сфокусирована, ничего не начато", async () => {
    await seedCatalog(db, ["greek", "it", "travel"]);
    setCatalogPhase("ready");
    const before = await rows();
    open("/share/course/travel");
    await at("/course");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(offers().find((o) => o.textContent?.includes("путешествий"))),
    );
    expect(await shelfLanguage(db)).toBe("en");
    expect(host.querySelector("h1")?.textContent).toBe("Полка");
    expect(shelves()).toHaveLength(0);
    expect(await rows()).toEqual(before);
    const keys = (await db.meta.toArray()).map((row) => row.key);
    expect(keys).not.toContain("primaryCourse");
    expect(keys).not.toContain("homeCourse");
    expect(keys).not.toContain("coursesOrder");
  });

  it("другие курсы начаты: полка нужного курса сфокусирована, основной курс прежний", async () => {
    await seedCatalog(db, ["greek", "it", "travel"]);
    await install(db, "greek");
    await install(db, "it");
    setCatalogPhase("ready");
    const primary = await primaryCourse(db);
    open("/share/course/it");
    await at("/course");
    await vi.waitFor(() => expect(shelves()).toHaveLength(1));
    await vi.waitFor(() => expect(document.activeElement).toBe(shelves()[0]));
    expect(shelves()[0].textContent).toContain("Для IT");
    expect(offers()).toHaveLength(1);
    expect(await primaryCourse(db)).toBe(primary);
    expect(primary).toBe("greek");
  });

  it("курс на паузе: плашка остаётся, пауза не снимается", async () => {
    await seedCatalog(db, ["greek", "it"]);
    await install(db, "greek");
    await install(db, "it");
    await pauseCourse("it", new Date(), db);
    setCatalogPhase("ready");
    open("/share/course/it");
    await at("/course");
    await vi.waitFor(() => expect(host.querySelector('[data-testid="shelf-paused"]')).not.toBeNull());
    expect(JSON.parse((await db.meta.get("coursePauses"))!.value)).toHaveProperty("it");
    expect(host.querySelector('[data-testid="shelf-paused"]')?.textContent).toContain("На паузе");
  });

  it("неизвестный курс при загруженном каталоге открывает «Сегодня»", async () => {
    await seedCatalog(db, ["greek", "it"]);
    setCatalogPhase("ready");
    open("/share/course/english-xyz");
    await at("/");
    expect(host.querySelector('[data-testid="today"]')).not.toBeNull();
    expect(await db.meta.count()).toBe(0);
  });

  it("пока каталог грузится — ожидание, затем полка", async () => {
    open("/share/course/travel");
    await vi.waitFor(() =>
      expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Загрузка курса"),
    );
    expect(router.state.location.pathname).toBe("/share/course/travel");
    await seedCatalog(db, ["greek", "travel"]);
    setCatalogPhase("ready");
    await at("/course");
  });

  it("каталог не загрузился и на устройстве пуст: сообщение и «Повторить»", async () => {
    setCatalogPhase("error");
    open("/share/course/travel");
    await vi.waitFor(() => expect(host.textContent).toContain("Каталог не загрузился"));
    expect([...host.querySelectorAll("button")].some((button) => button.textContent?.includes("Повторить"))).toBe(true);
    expect(router.state.location.pathname).toBe("/share/course/travel");
  });

  it("после ошибки каталог загрузился: открывается полка курса", async () => {
    setCatalogPhase("error");
    open("/share/course/travel");
    await vi.waitFor(() => expect(host.textContent).toContain("Каталог не загрузился"));
    await seedCatalog(db, ["greek", "travel"]);
    setCatalogPhase("ready");
    await at("/course");
  });

  it("каталог не загрузился, на устройстве есть другие курсы, а курса нет: «Каталог не загрузился», не «Сегодня»", async () => {
    await seedCatalog(db, ["greek"]);
    setCatalogPhase("error");
    open("/share/course/travel");
    await vi.waitFor(() => expect(host.textContent).toContain("Каталог не загрузился"));
    expect(router.state.location.pathname).toBe("/share/course/travel");
  });

  it("курс языка, который и так показан, не создаёт явного выбора языка", async () => {
    await seedCatalog(db, ["greek", "it"]);
    await install(db, "greek");
    setCatalogPhase("ready");
    open("/share/course/greek");
    await at("/course");
    await vi.waitFor(() => expect(document.activeElement).toBe(shelves()[0]));
    const keys = (await db.meta.toArray()).map((row) => row.key);
    expect(keys).not.toContain("currentLanguage");
  });
});

describe("кнопка «Поделиться курсом» на полке", () => {
  const buttons = () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
      (b) => b.textContent?.trim() === "Поделиться курсом",
    );

  it("есть у начатого и приостановленного курса, нет у карточки неначатого", async () => {
    await seedCatalog(db, ["greek", "it", "travel"]);
    await install(db, "it");
    await install(db, "travel");
    await pauseCourse("travel", new Date(), db);
    await db.meta.put({ key: "currentLanguage", value: "en" });
    setCatalogPhase("ready");
    open("/course");
    await vi.waitFor(() => expect(shelves()).toHaveLength(2));
    expect(buttons()).toHaveLength(2);
    expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Поделиться курсом «Английский для IT»",
      "Поделиться курсом «Английский для путешествий»",
    ]);
    for (const shelf of shelves())
      expect(shelf.querySelectorAll("button[aria-label^='Поделиться курсом']")).toHaveLength(1);
  });

  it("нет у карточки неначатого курса", async () => {
    await seedCatalog(db, ["greek", "it", "travel"]);
    await install(db, "greek");
    await db.meta.put({ key: "currentLanguage", value: "en" });
    setCatalogPhase("ready");
    open("/course");
    await vi.waitFor(() => expect(offers()).toHaveLength(2));
    expect(buttons()).toHaveLength(0);
  });

  it("в браузере без системного меню копирует ссылку на курс", async () => {
    await seedCatalog(db, ["greek", "it"]);
    await install(db, "it");
    await db.meta.put({ key: "currentLanguage", value: "en" });
    setCatalogPhase("ready");
    open("/course");
    await vi.waitFor(() => expect(buttons()).toHaveLength(1));
    buttons()[0].click();
    await vi.waitFor(() => expect(copied).toEqual(["https://t.me/tetradio_local?startapp=c_it"]));
    expect(toast.success).toHaveBeenCalledWith("Ссылка скопирована");
  });
});
