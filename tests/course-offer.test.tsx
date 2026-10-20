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
    [1, "16 модулей, готов 1"],
    [2, "16 модулей, готовы 2"],
    [5, "16 модулей, готово 5"],
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
  it("два языка — группы по месту курса, названия курсов на третьем уровне", () => {
    const offers = render(
      [
        course("english", { language: "en", order: 2 }),
        course("travel", { language: "en", order: 3 }),
        course("greek-a2", { language: "el", order: 1 }),
      ],
      [entry("e1", "english", "en", 0), entry("g1", "greek-a2", "el", 1)],
      [...modules("travel", 1, 0)],
    );
    expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Греческий", "Английский"]);
    expect(offers.map((offer) => [offer.title, offer.heading])).toEqual([
      ["greek-a2", "H3"],
      ["english", "H3"],
      ["travel", "H3"],
    ]);
  });
  it("курс, убранный из каталога, не показывается", () => {
    const offers = render([course("gone"), course("en")], [entry("e1", "en", "en", 0)], []);
    expect(offers.map((offer) => offer.title)).toEqual(["en"]);
  });
});
