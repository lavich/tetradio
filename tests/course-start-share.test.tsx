// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import type { Course, StoredModule } from "../src/domain/types";
import type { StoredCatalogEntry } from "../src/storage/db";
import { FirstRun } from "../src/features/today/FirstRun";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLElement;
let copied: string[];
beforeEach(() => {
  copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
});
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

function render(props: { grouped?: boolean; courses?: Course[] } = {}) {
  container = document.createElement("div");
  root = createRoot(container);
  act(() =>
    root!.render(
      <FirstRun courses={props.courses ?? courses} entries={entries} modules={mods} grouped={props.grouped} />,
    ),
  );
  return [...container.querySelectorAll<HTMLElement>("[data-testid=course-offer]")];
}
const share = (offer: HTMLElement) =>
  [...offer.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent?.trim() === "Поделиться курсом");

describe.each([
  ["сгруппированный вид", true],
  ["вид без групп", false],
])("«Поделиться курсом» на карточке неначатого курса, %s", (_name, grouped) => {
  it("у каждой карточки одна кнопка со своим названием курса", () => {
    const offers = render({ grouped });
    expect(offers).toHaveLength(3);
    expect(offers.map((offer) => share(offer).map((b) => b.getAttribute("aria-label")))).toEqual([
      ["Поделиться курсом «Греческий»"],
      ["Поделиться курсом «Английский для IT»"],
      ["Поделиться курсом «Английский для путешествий»"],
    ]);
  });
  it("стоит после «Учить курс» и не отключена", () => {
    const [offer] = render({ grouped });
    const names = [...offer.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Учить курс «Греческий»", "Поделиться курсом «Греческий»"]);
    expect(share(offer)[0].disabled).toBe(false);
    expect(share(offer)[0].getAttribute("aria-disabled")).toBeNull();
  });
  it("копирует ссылку именно этого курса", async () => {
    const offers = render({ grouped });
    await act(async () => share(offers[2])[0].click());
    await vi.waitFor(() => expect(copied).toHaveLength(1));
    expect(copied).toEqual(["https://t.me/tetradio_local?startapp=c_english-travel"]);
    expect(toast.success).toHaveBeenCalledWith("Ссылка скопирована");
  });
});

it("у карточки «Готовится» кнопки нет", () => {
  const [offer] = render({ courses: [course("travel", { title: "Путешествия", language: "en" })] });
  expect(offer.querySelector("[data-testid=course-preparing]")).not.toBeNull();
  expect(share(offer)).toHaveLength(0);
});
