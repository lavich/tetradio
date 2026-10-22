// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { CourseScreen } from "../src/features/course/ShelfScreen";
import { db, type StoredCatalogEntry } from "../src/storage/db";
import { pauseCourse } from "../src/storage/pause-actions";
import { chooseShelfCourse, rememberCourses, setCurrentLanguage, shelfCourse } from "../src/storage/courses";
import { PRIMARY_COURSE_KEY } from "../src/storage/courses";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
Element.prototype.scrollIntoView = vi.fn();

const iso = "2026-10-20T09:00:00.000Z";
const entry = (id: string, courseId: string, language: string, position: number): StoredCatalogEntry => ({
  id,
  courseId,
  language,
  title: id,
  wordCount: 0,
  phraseCount: 0,
  cardCount: 0,
  version: "1",
  url: "",
  bytes: 0,
  media: { count: 0, bytes: 0 },
  position,
});
const courses = [
  { id: "greek-a2", title: "Греческий A2", short: "A2", order: 1 },
  { id: "greek-b1", title: "Греческий B1", short: "B1", order: 2 },
  { id: "english-it", title: "Английский для IT", short: "Для IT", language: "en", order: 3 },
  { id: "english-travel", title: "Английский для путешествий", short: "Для путешествий", language: "en", order: 4 },
];
const start = async (courseId: string, number: number) => {
  await db.lessons.add({ id: `${courseId}-1`, courseId, title: courseId, completed: false, updatedAt: iso });
  await db.modules.add({
    id: `${courseId}-m`,
    courseId,
    number,
    title: `Модуль ${courseId}`,
    subtitle: `Подзаголовок ${courseId}`,
    status: "published",
    goal: "",
    grammar: [],
    sessions: 1,
    lessonIds: [`${courseId}-1`],
    position: number,
  });
  await rememberCourses(db);
};

let root: Root | null = null;
let host: HTMLElement;
let router: ReturnType<typeof createMemoryRouter>;
const mount = (state?: { course: string }) => {
  router = createMemoryRouter([{ path: "/course", element: <CourseScreen /> }], {
    initialEntries: [{ pathname: "/course", state }],
  });
  root = createRoot(host);
  root.render(<RouterProvider router={router} />);
};
const settled = (check: () => void) => vi.waitFor(check, 5000);
const switchOf = () => host.querySelector('[data-testid="course-switch"]');
const options = () => [...(switchOf()?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
const shelves = () => [...host.querySelectorAll('[data-testid="course-shelf"] h2')].map((h) => h.textContent);
const offers = () => [...host.querySelectorAll('[data-testid="course-offer"] h2')].map((h) => h.textContent);

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.courses.bulkAdd(courses.map((course) => ({ ...course, updatedAt: iso })));
  await db.catalog.bulkAdd([
    entry("greek-a2-1", "greek-a2", "el", 0),
    entry("greek-b1-1", "greek-b1", "el", 1),
    entry("english-it-1", "english-it", "en", 2),
    entry("english-travel-1", "english-travel", "en", 3),
  ]);
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

describe("«Курс»: заголовок", () => {
  it("видимого слова «Полка» нет, h1 «Курс» остаётся для читалки", async () => {
    await start("greek-a2", 1);
    mount();
    await settled(() => expect(shelves()).toHaveLength(1));
    expect(host.textContent).not.toContain("Полка");
    const h1 = host.querySelectorAll("h1");
    expect([...h1].map((h) => h.textContent)).toEqual(["Курс"]);
    expect(h1[0].className).toContain("sr-only");
  });
});

describe("«Курс»: переключатель курсов", () => {
  it("один курс языка — переключателя курсов нет", async () => {
    await db.courses.delete("greek-b1");
    await db.catalog.delete("greek-b1-1");
    await start("greek-a2", 1);
    mount();
    await settled(() => expect(shelves()).toHaveLength(1));
    expect(switchOf()).toBeNull();
  });

  it("греческий A2 и B1: «A2» и «+ B1», показана полка A2; выбор B1 показывает карточку, а не пустоту", async () => {
    await start("greek-a2", 1);
    mount();
    await settled(() => expect(options().map((option) => option.textContent)).toEqual(["A2", "+ B1"]));
    expect(switchOf()?.getAttribute("aria-label")).toBe("Курс языка");
    expect(options()[1].getAttribute("aria-label")).toBe("B1, не начат");
    expect(shelves()).toEqual(["A2"]);
    options()[1].click();
    await settled(() => expect(offers()).toEqual(["Греческий B1"]));
    expect(shelves()).toEqual([]);
    expect(options()[1].getAttribute("aria-checked")).toBe("true");
  });

  it("два начатых английских курса: показан основной, выбор второго скрывает первый, выбор запоминается", async () => {
    await start("english-it", 1);
    await start("english-travel", 1);
    await setCurrentLanguage("en", db);
    mount();
    await settled(() => expect(shelves()).toEqual(["Для IT"]));
    expect(options().map((option) => option.textContent)).toEqual(["Для IT", "Для путешествий"]);
    options()[1].click();
    await settled(() => expect(shelves()).toEqual(["Для путешествий"]));
    expect(await shelfCourse(db)).toBe("english-travel");
    root!.unmount();
    host.innerHTML = "";
    root = null;
    mount();
    await settled(() => expect(shelves()).toEqual(["Для путешествий"]));
    expect(options()[1].getAttribute("aria-checked")).toBe("true");
  });

  it("основной курс определяет курс по умолчанию", async () => {
    await start("english-it", 1);
    await start("english-travel", 1);
    await db.meta.put({ key: PRIMARY_COURSE_KEY, value: "english-travel" });
    await setCurrentLanguage("en", db);
    mount();
    await settled(() => expect(shelves()).toEqual(["Для путешествий"]));
  });

  it("неначатый курс среди начатых показывает карточку и не мешает полке после переключения обратно", async () => {
    await start("english-it", 1);
    await setCurrentLanguage("en", db);
    mount();
    await settled(() => expect(options().map((option) => option.textContent)).toEqual(["Для IT", "+ Для путешествий"]));
    options()[1].click();
    await settled(() => expect(offers()).toEqual(["Английский для путешествий"]));
    expect(shelves()).toEqual([]);
    options()[0].click();
    await settled(() => expect(shelves()).toEqual(["Для IT"]));
    expect(offers()).toEqual([]);
  });

  it("пауза и меню курса работают у выбранного курса, другой курс не затронут", async () => {
    await start("english-it", 1);
    await start("english-travel", 1);
    await setCurrentLanguage("en", db);
    await chooseShelfCourse("english-travel", db);
    await pauseCourse("english-travel", new Date("2026-10-12T09:00:00Z"), db);
    mount();
    await settled(() => expect(shelves()).toEqual(["Для путешествий"]));
    const menu = host.querySelector('button[aria-label^="Действия с курсом"]')!;
    expect(menu.getAttribute("aria-label")).toBe("Действия с курсом «Английский для путешествий»");
    expect(host.querySelector('[data-testid="shelf-paused"]')?.textContent).toContain("На паузе с");
    host.querySelector<HTMLButtonElement>('[data-testid="shelf-paused"] button')!.click();
    await settled(() => expect(host.querySelector('[data-testid="shelf-paused"]')).toBeNull());
    options()[0].click();
    await settled(() => expect(shelves()).toEqual(["Для IT"]));
    expect(host.querySelector('[data-testid="shelf-paused"]')).toBeNull();
  });

  it("state.course выбирает курс, язык и убирает состояние из адреса", async () => {
    await start("greek-a2", 1);
    mount({ course: "english-travel" });
    await settled(() => expect(offers()).toEqual(["Английский для путешествий"]));
    await settled(() => expect(router.state.location.state).toBeNull());
    expect(await shelfCourse(db)).toBe("english-travel");
  });

  it("state.course неизвестного курса выбор не меняет", async () => {
    await start("greek-a2", 1);
    mount({ course: "nope" });
    await settled(() => expect(router.state.location.state).toBeNull());
    expect(shelves()).toEqual(["A2"]);
  });
});
