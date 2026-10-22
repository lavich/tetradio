// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const idle = vi.hoisted(() => ({ phase: "idle" }));
const phases = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("../src/content/client", async (original) => ({
  ...(await original<typeof import("../src/content/client")>()),
  coursePhase: (id: string) => phases[id] ?? idle,
  subscribeInstall: () => () => undefined,
}));

import type { Course, StoredModule } from "../src/domain/types";
import type { StoredCatalogEntry } from "../src/storage/db";
import { FirstRun } from "../src/features/today/FirstRun";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const iso = "2026-10-20T09:00:00Z";
const course = (id: string, fields: Partial<Course> = {}): Course => ({ id, title: id, updatedAt: iso, ...fields });
const entry = (courseId: string, language: string, position: number): StoredCatalogEntry => ({
  id: `${courseId}-1`,
  courseId,
  language,
  title: courseId,
  wordCount: 0,
  phraseCount: 0,
  cardCount: 0,
  version: "1",
  url: "",
  bytes: 0,
  media: { count: 0, bytes: 0 },
  position,
});
const modules = (courseId: string, published: number): StoredModule[] => [
  {
    id: `${courseId}-m1`,
    courseId,
    number: 1,
    title: "",
    subtitle: "",
    status: published ? "published" : "draft",
    goal: "",
    grammar: [],
    sessions: 3,
    lessonIds: [],
    position: 0,
  },
];

const courses = [
  course("greek-a2", { title: "Греческий", language: "el", order: 1 }),
  course("english-it", { title: "Английский для IT", language: "en", order: 2 }),
  course("english-travel", { title: "Английский для путешествий", language: "en", order: 3 }),
];
const entries = [entry("greek-a2", "el", 0), entry("english-it", "en", 1), entry("english-travel", "en", 2)];
const mods = [
  ...modules("greek-a2", 1),
  ...modules("english-it", 1),
  ...modules("english-travel", 1),
  ...modules("travel", 0),
];

function render(show?: string) {
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(<FirstRun courses={courses} entries={entries} modules={mods} grouped={false} show={show} />));
  return [...container.querySelectorAll<HTMLElement>("[data-testid=course-offer]")];
}
const names = (offer: HTMLElement) => [...offer.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));

describe("«Поделиться курсом» рядом с состояниями «Учить курс»", () => {
  beforeEach(() => {
    phases["english-it"] = { phase: "loading" };
    phases["greek-a2"] = { phase: "error", message: "Нет сети" };
  });
  it("не блокируется загрузкой, ожиданием другого курса и ошибкой; идёт после «Повторить»", () => {
    const [greek, loading, waiting] = render();
    expect(names(loading)).toEqual(["Загружаем курс «Английский для IT»…", "Поделиться курсом «Английский для IT»"]);
    expect(names(waiting)).toEqual([
      "Учить курс «Английский для путешествий»",
      "Поделиться курсом «Английский для путешествий»",
    ]);
    expect(names(greek)).toEqual(["Учить курс «Греческий»", null, "Поделиться курсом «Греческий»"]);
    for (const offer of [greek, loading, waiting]) {
      const button = offer.querySelector<HTMLButtonElement>('button[aria-label^="Поделиться курсом"]')!;
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-disabled")).toBeNull();
    }
  });
  it("при show показывается одна карточка с одной кнопкой", () => {
    const offers = render("english-travel");
    expect(offers).toHaveLength(1);
    expect(names(offers[0]).filter((name) => name?.startsWith("Поделиться"))).toHaveLength(1);
  });
});
