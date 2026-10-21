// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { db } from "../src/storage/db";
import { rememberCourses } from "../src/storage/courses";
import { pauseCourse } from "../src/storage/pause-actions";

const planned = vi.hoisted(() => [] as unknown[]);
vi.mock("../src/shared/store", async (original) => {
  const actual = await original<typeof import("../src/shared/store")>();
  return {
    ...actual,
    useLanguagePlan: (language: Parameters<typeof actual.useLanguagePlan>[0]) => {
      planned.push(language);
      return actual.useLanguagePlan(language);
    },
  };
});
const { TodayScreen } = await import("../src/features/today/TodayScreen");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  planned.length = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

it("все курсы на паузе — общий план по всем курсам не строится", async () => {
  for (const id of ["greek", "english"]) {
    await db.courses.add({ id, title: id, updatedAt: "2026-10-01T09:00:00Z" });
    await db.lessons.add({
      id: `${id}-1`,
      courseId: id,
      title: "1",
      completed: true,
      updatedAt: "2026-10-01T09:00:00Z",
    });
    await db.packages.add({
      lessonId: `${id}-1`,
      courseId: id,
      version: "1",
      schemaVersion: 4,
      installedAt: "2026-10-01T09:00:00Z",
      words: [],
      phrases: [],
      items: [],
      media: [],
    } as never);
    await rememberCourses(db);
    await pauseCourse(id, new Date("2026-10-12T09:00:00Z"), db);
  }
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() =>
    root!.render(
      <MemoryRouter>
        <TodayScreen />
      </MemoryRouter>,
    ),
  );
  for (let i = 0; i < 100 && !host.textContent?.includes("Все курсы на паузе"); i++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(host.textContent).toContain("Все курсы на паузе");
  expect(planned.length).toBeGreaterThan(0);
  expect(planned).not.toContain(null);
});
