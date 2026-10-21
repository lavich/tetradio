// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { CourseScreen } from "../src/features/course/ShelfScreen";
import { db, type StoredCatalogEntry } from "../src/storage/db";
import { rememberCourses, setCurrentLanguage } from "../src/storage/courses";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
const scrolled = vi.fn();
Element.prototype.scrollIntoView = scrolled;

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

let root: Root | null = null;
let host: HTMLElement;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.courses.bulkAdd([
    { id: "greek-a2", title: "Греческий", order: 1, updatedAt: iso },
    { id: "english-it", title: "Английский для IT", language: "en", order: 2, updatedAt: iso },
  ]);
  await db.catalog.bulkAdd([entry("g-1", "greek-a2", "el", 0), entry("e-1", "english-it", "en", 1)]);
  await db.lessons.add({ id: "g-1", courseId: "greek-a2", title: "g", completed: false, updatedAt: iso });
  await rememberCourses(db);
  host = document.body.appendChild(document.createElement("div"));
  scrolled.mockClear();
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});
const card = () => host.querySelector<HTMLElement>('[data-testid="course-offer"]');

describe("карточка курса из «Начать другой курс»", () => {
  it("получает фокус один раз: после смены языка туда и обратно фокус и прокрутка не возвращаются", async () => {
    await setCurrentLanguage("en", db);
    const router = createMemoryRouter([{ path: "/course", element: <CourseScreen /> }], {
      initialEntries: [{ pathname: "/course", state: { course: "english-it" } }],
    });
    root = createRoot(host);
    root.render(<RouterProvider router={router} />);
    await vi.waitFor(() => expect(document.activeElement).toBe(card()), 5000);
    expect(scrolled).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(router.state.location.state).toBeNull(), 5000);
    (document.activeElement as HTMLElement).blur();
    await setCurrentLanguage("el", db);
    await vi.waitFor(() => expect(card()).toBeNull(), 5000);
    await setCurrentLanguage("en", db);
    await vi.waitFor(() => expect(card()).not.toBeNull(), 5000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement).not.toBe(card());
    expect(scrolled).toHaveBeenCalledTimes(1);
  }, 20000);
});
