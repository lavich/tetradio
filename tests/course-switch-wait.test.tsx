// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { CourseScreen } from "../src/features/course/ShelfScreen";
import { db, type StoredCatalogEntry } from "../src/storage/db";
import { chooseShelfCourse } from "../src/storage/courses";

const loading = { phase: "loading" } as const;
const idle = { phase: "idle" } as const;
vi.mock("../src/content/client", async (original) => ({
  ...(await original<typeof import("../src/content/client")>()),
  coursePhase: (id: string) => (id === "english-it" ? loading : idle),
  subscribeInstall: () => () => undefined,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
const iso = "2026-10-20T09:00:00.000Z";
const entry = (id: string, courseId: string, position: number): StoredCatalogEntry => ({
  id,
  courseId,
  language: "en",
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
    { id: "english-it", title: "Английский для IT", short: "Для IT", language: "en", order: 1, updatedAt: iso },
    {
      id: "english-travel",
      title: "Английский для путешествий",
      short: "Для путешествий",
      language: "en",
      order: 2,
      updatedAt: iso,
    },
  ]);
  await db.catalog.bulkAdd([entry("english-it-1", "english-it", 0), entry("english-travel-1", "english-travel", 1)]);
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

describe("«Курс»: два неначатых курса языка", () => {
  it("пока ставится первый курс, у второго после переключения «Учить курс» недоступна с пояснением", async () => {
    await chooseShelfCourse("english-travel", db);
    root = createRoot(host);
    root.render(
      <MemoryRouter initialEntries={["/course"]}>
        <CourseScreen />
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(host.querySelectorAll('[data-testid="course-offer"]')).toHaveLength(1), 5000);
    expect(host.querySelector('[data-testid="course-offer"] h2')?.textContent).toBe("Английский для путешествий");
    expect(host.textContent).toContain("Сначала загрузится «Английский для IT»");
    expect(host.querySelector("article button")?.getAttribute("aria-disabled")).toBe("true");
  });
});
