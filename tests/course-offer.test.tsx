// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Course, StoredModule } from "../src/domain/types";
import type { StoredCatalogEntry } from "../src/storage/db";
import { FirstRun } from "../src/features/today/FirstRun";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const iso = "2026-10-20T09:00:00Z";
const course = (id: string, fields: Partial<Course> = {}): Course => ({ id, title: id, updatedAt: iso, ...fields });
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
const modules = (courseId: string, total: number, published: number): StoredModule[] =>
  Array.from({ length: total }, (_, i) => ({
    id: `${courseId}-m${i + 1}`,
    courseId,
    number: i + 1,
    title: "",
    subtitle: "",
    status: i < published ? "published" : "draft",
    goal: "",
    grammar: [],
    sessions: 3,
    lessonIds: [],
    position: i,
  }));

function render(courses: Course[], entries: StoredCatalogEntry[], mods: StoredModule[]) {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(<FirstRun courses={courses} entries={entries} modules={mods} />));
  return [...container.querySelectorAll<HTMLElement>("[data-testid=course-offer]")].map((offer) => ({
    title: offer.querySelector("h2, h3")?.textContent,
    heading: offer.querySelector("h2, h3")?.tagName,
    text: offer.querySelector("[data-testid=first-course]")?.textContent,
    button: !!offer.querySelector("button"),
    preparing: !!offer.querySelector("[data-testid=course-preparing]"),
  }));
}

describe("карточка курса", () => {
  it("все поля: название с уровнем, цель, объём, без нагрузки", () => {
    const [offer] = render(
      [course("greek-a2", { title: "Греческий", level: "A0 → A2", goal: "С нуля до A2", language: "el" })],
      [entry("m01-1", "greek-a2", "el", 0)],
      modules("greek-a2", 24, 24),
    );
    expect(offer.title).toBe("Греческий · A0 → A2");
    expect(offer.text).toBe("Греческий · A0 → A2С нуля до A224 модуля");
    expect(offer.text).not.toMatch(/в неделю/);
    expect(offer.button).toBe(true);
  });
  it("без цели и уровня — без пустых строк", () => {
    const [offer] = render([course("en", { title: "Английский" })], [entry("e1", "en", "en", 0)], modules("en", 1, 1));
    expect(offer.text).toBe("Английский1 модуль");
  });
  it.each([
    [1, "Готов 1 модуль из 16"],
    [2, "Готовы 2 модуля из 16"],
    [5, "Готово 5 модулей из 16"],
  ])("черновые модули: %i готовых — «%s»", (published, volume) => {
    const [offer] = render([course("it")], [entry("e1", "it", "en", 0)], modules("it", 16, published));
    expect(offer.text).toContain(volume);
  });
  it("курс без опубликованных уроков — «Готовится», без кнопки", () => {
    const [offer] = render([course("travel", { language: "en" })], [], modules("travel", 1, 0));
    expect(offer.preparing).toBe(true);
    expect(offer.button).toBe(false);
  });
  it("курс из уроков без модулей — число уроков", () => {
    const [offer] = render([course("mech")], [entry("a", "mech", "el", 0), entry("b", "mech", "el", 1)], []);
    expect(offer.text).toContain("2 урока");
  });
  it("греческое слово в цели размечено языком", () => {
    render(
      [course("greek-a2", { goal: "До экзамена ΚΕΓ A2" })],
      [entry("m01-1", "greek-a2", "el", 0)],
      modules("greek-a2", 1, 1),
    );
    expect(container.querySelector('[lang="el"]')?.textContent).toBe("ΚΕΓ");
  });
  it("заголовок языка — только у языка с двумя курсами и больше; главная кнопка — у первого курса", () => {
    const offers = render(
      [
        course("english", { language: "en", order: 2 }),
        course("travel", { language: "en", order: 3 }),
        course("greek-a2", { language: "el", order: 1 }),
      ],
      [entry("e1", "english", "en", 0), entry("g1", "greek-a2", "el", 1)],
      [...modules("travel", 1, 0)],
    );
    expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["greek-a2", "Английский"]);
    expect(offers.map((offer) => [offer.title, offer.heading])).toEqual([
      ["greek-a2", "H2"],
      ["english", "H3"],
      ["travel", "H3"],
    ]);
    const buttons = [...container.querySelectorAll('button[aria-label^="Учить курс"]')];
    expect(buttons.map((button) => button.className.includes("bg-primary "))).toEqual([true, false]);
  });
  it("курс, убранный из каталога, не показывается", () => {
    const offers = render([course("gone"), course("en")], [entry("e1", "en", "en", 0)], []);
    expect(offers.map((offer) => offer.title)).toEqual(["en"]);
  });
});

describe("первый экран «Сегодня»", () => {
  const intro = (courses: Course[], entries: StoredCatalogEntry[], mods: StoredModule[]) => {
    container = document.createElement("div");
    root = createRoot(container);
    act(() => root!.render(<FirstRun courses={courses} entries={entries} modules={mods} hint={false} intro />));
    return container;
  };
  const greek = course("greek-a2", {
    title: "Греческий",
    level: "A0 → A2",
    goal: "С нуля до экзамена ΚΕΓ A2",
    entry: "Для начала достаточно знать греческий алфавит.",
    pace: "2–3 часа в неделю",
    calendar: {
      start: "2026-10-05",
      checkpoints: [
        { label: "K1", title: "Контрольная A1", afterModule: 1, date: "2026-12-13" },
        { label: "M1", title: "Пробник", afterModule: 2, date: "2027-02-13" },
      ],
    },
  });

  it("единственный курс — заголовок экрана, под ним цель, вход и факты курса без карточки", () => {
    const page = intro([greek], [entry("m01-1", "greek-a2", "el", 0)], modules("greek-a2", 2, 2));
    expect(page.querySelector("h1")?.textContent).toBe("Греческий · A0 → A2");
    expect(page.querySelector("h1 + p")?.textContent).toBe(
      "С нуля до экзамена ΚΕΓ A2. Для начала достаточно знать греческий алфавит.",
    );
    expect(page.querySelector("h1 + p [lang=el]")?.textContent).toBe("ΚΕΓ");
    const facts = [...page.querySelectorAll("[data-testid=course-intro] > div")].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]);
    expect(facts.map(([term]) => term)).toEqual(["Программа", "Время", "Звук", "Без сети"]);
    expect(facts[0][1]).toBe("2 модуля и 2 контрольные точки");
    expect(facts[1][1]).toBe("2–3 часа в неделю");
    expect(facts[2][1]).toContain("без греческого голоса");
    expect(page.querySelector("[data-testid=first-course]")).toBeNull();
    const offer = page.querySelector("[data-testid=course-offer]")!;
    expect(offer.getAttribute("aria-labelledby")).toBe("today-title");
    expect(page.querySelector("#today-title")).toBe(page.querySelector("h1"));
  });

  it("без нагрузки и календаря строки «Время» нет, программа — объём курса", () => {
    const bare = course("greek-a2", { title: "Греческий" });
    const page = intro([bare], [entry("m01-1", "greek-a2", "el", 0)], modules("greek-a2", 3, 3));
    const terms = [...page.querySelectorAll("[data-testid=course-intro] dt")].map((term) => term.textContent);
    expect(terms).toEqual(["Программа", "Звук", "Без сети"]);
    expect(page.querySelector("[data-testid=course-intro] dd")?.textContent).toBe("3 модуля");
    expect(page.querySelector("h1 + p")).toBeNull();
  });

  it("у нескольких курсов — общий заголовок и карточки", () => {
    const english = course("english-it", { title: "Английский", language: "en", level: "B1 → B2" });
    const page = intro(
      [greek, english],
      [entry("m01-1", "greek-a2", "el", 0), entry("e01-1", "english-it", "en", 1)],
      [...modules("greek-a2", 2, 2), ...modules("english-it", 1, 1)],
    );
    expect(page.querySelector("h1")?.textContent).toBe("Выберите курс");
    expect(page.querySelector("[data-testid=course-intro]")).toBeNull();
    expect(page.querySelectorAll("[data-testid=first-course]")).toHaveLength(2);
  });
});
