// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ReadingsScreen } from "../src/features/course/ReadingsScreen";
import { db, type StoredCatalogEntry } from "../src/storage/db";
import { rememberCourses, setCurrentLanguage } from "../src/storage/courses";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

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
    { id: "english-travel", title: "Английский для путешествий", language: "en", order: 3, updatedAt: iso },
  ]);
  await db.catalog.bulkAdd([
    entry("g-1", "greek-a2", "el", 0),
    entry("e-1", "english-it", "en", 1),
    entry("t-1", "english-travel", "en", 2),
  ]);
  for (const [id, courseId] of [
    ["g-1", "greek-a2"],
    ["e-1", "english-it"],
    ["t-1", "english-travel"],
  ])
    await db.lessons.add({ id, courseId, title: id, completed: true, updatedAt: iso });
  await rememberCourses(db);
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});
const shown = async (text: string) => {
  root = createRoot(host);
  root.render(
    <MemoryRouter>
      <ReadingsScreen />
    </MemoryRouter>,
  );
  await vi.waitFor(() => expect(host.textContent).toContain(text), 5000);
};

describe("«Чтение» без текстов", () => {
  it("у языка с одним курсом без текстов — «В этом курсе текстов нет.»", async () => {
    await shown("В этом курсе текстов нет.");
    expect(host.querySelector('[data-testid="reading-summary"]')).toBeNull();
  });
  it("у языка с двумя курсами без текстов — «У курсов языка текстов нет.», без сводки и групп", async () => {
    await setCurrentLanguage("en", db);
    await shown("У курсов языка текстов нет.");
    expect(host.querySelector('[data-testid="reading-summary"]')).toBeNull();
    expect(host.querySelector('[data-testid="reading-course"]')).toBeNull();
  });
});
