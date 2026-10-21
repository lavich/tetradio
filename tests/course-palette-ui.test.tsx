// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { PALETTES } from "../src/content/palettes";
import { ModuleCover } from "../src/features/course/ModuleCover";
import { Path } from "../src/features/progress/ProgressScreen";
import { LessonNext } from "../src/features/today/CourseToday";
import type { ModuleLessonView, ModuleView } from "../src/storage/course";
import { db, type StoredCatalogEntry } from "../src/storage/db";
import type { CourseProgress } from "../src/storage/progress";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const iso = "2026-10-20T09:00:00.000Z";
const entry = (id: string, courseId: string, language: string): StoredCatalogEntry => ({
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
  position: 0,
});
const lesson = {
  id: "x-1",
  title: "Урок",
  kind: "lesson",
  completed: true,
  installed: true,
  tally: { done: 1, total: 2 },
};
const view = (courseId: string, number = 1) =>
  ({
    module: { id: `${courseId}-m${number}`, courseId, number, title: "Work", subtitle: "Работа", status: "published" },
    lessons: [lesson],
    review: [],
    completed: true,
  }) as unknown as ModuleView;
const progress = (courseId: string) =>
  ({
    views: [view(courseId), view(courseId, 2)],
    current: 2,
    pace: { done: 2, total: 4, planned: 2, recentPerWeek: null },
    calendar: undefined,
  }) as unknown as CourseProgress;

let root: Root | null = null;
let host: HTMLElement;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.courses.bulkAdd([
    { id: "greek-a2", title: "Греческий", updatedAt: iso },
    { id: "english-it", title: "Английский для IT", language: "en", palette: "ink", updatedAt: iso },
  ]);
  await db.catalog.bulkAdd([entry("g-1", "greek-a2", "el"), entry("e-1", "english-it", "en")]);
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});
const mount = async (screen: React.ReactNode) => {
  root = createRoot(host);
  root!.render(<MemoryRouter>{screen}</MemoryRouter>);
};
const settled = (check: () => void) => vi.waitFor(check, 5000);
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(", ")})`;

describe("обложки в гамме курса", () => {
  it("изнанка обложки английского курса — цвет гаммы ink", async () => {
    await mount(<ModuleCover view={view("english-it")} open />);
    await settled(() =>
      expect(
        host.querySelector<HTMLElement>('[aria-label="Обложка модуля 1"]')?.style.getPropertyValue("--cover"),
      ).toBe(PALETTES.ink[0]),
    );
  });
  it("обложка урока на «Сегодня»: английский — ink, греческий — прежний цвет", async () => {
    await mount(<LessonNext view={view("english-it")} lesson={lesson as unknown as ModuleLessonView} primary />);
    const cover = () => host.querySelector<HTMLElement>('[data-testid="course-next"] span');
    await settled(() => expect(cover()?.style.background).toBe(rgb(PALETTES.ink[0])));
    root!.render(
      <MemoryRouter>
        <LessonNext view={view("greek-a2")} lesson={lesson as unknown as ModuleLessonView} primary />
      </MemoryRouter>,
    );
    await settled(() => expect(cover()?.style.background).toBe(rgb("#2f6d4f")));
  });
  it("пройденный модуль в пути «Прогресса»: английский — ink, греческий — прежний цвет", async () => {
    await mount(<Path data={progress("english-it")} />);
    const spine = () => host.querySelector<HTMLElement>("i");
    await settled(() => expect(spine()?.style.background).toBe(rgb(PALETTES.ink[0])));
    root!.render(
      <MemoryRouter>
        <Path data={progress("greek-a2")} />
      </MemoryRouter>,
    );
    await settled(() => expect(spine()?.style.background).toBe(rgb("#2f6d4f")));
  });
});
