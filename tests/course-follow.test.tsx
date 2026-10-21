// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildContent } from "../content/build";
import { installLesson, refreshCatalog } from "../src/content/client";
import { MemoryRouter } from "react-router-dom";
import { ReadingSheet } from "../src/features/today/ReadingSheet";
import { useFollowCourse } from "../src/shared/courses";
import {
  currentLanguage,
  setCurrentCourse,
  setCurrentLanguage,
  shelfCourse,
  shelfLanguage,
} from "../src/storage/courses";
import type { CourseReadings, ReadingView } from "../src/storage/readings";
import { db } from "../src/storage/db";
import { memoryFetcher } from "./helpers/content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const built = buildContent("tests/fixtures/two-courses");
let root: Root | null = null;

function Follow({ courseId }: { courseId: string }) {
  useFollowCourse(courseId);
  return null;
}
beforeEach(async () => {
  db.close();
  await db.delete();
  await db.open();
  const fetcher = memoryFetcher(built);
  await refreshCatalog(db, fetcher);
  await installLesson("m01-1", db, fetcher);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("модуль, открытый по ссылке", () => {
  it("возвращает полку к своему курсу, когда на «Курсе» выбран неначатый", async () => {
    await setCurrentCourse("english", db);
    expect(await shelfCourse(db)).toBe("english");
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(<Follow courseId="greek-a2" />));
    await vi.waitFor(async () => expect(await shelfCourse(db)).toBe("greek-a2"));
  });
});

describe("ссылка выбирает язык курса", () => {
  const follow = async (courseId: string) => {
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(<Follow courseId={courseId} />));
  };

  it("модуль английского курса при выбранном греческом выбирает английский язык", async () => {
    await installLesson("e01-1", db, memoryFetcher(built));
    await setCurrentLanguage("el", db);
    await follow("english");
    await vi.waitFor(async () => expect(await currentLanguage(db)).toBe("en"));
    expect(await shelfLanguage(db)).toBe("en");
  });
  it("курс показанного языка выбор не пишет", async () => {
    await follow("greek-a2");
    await act(async () => {});
    expect(await db.meta.get("currentLanguage")).toBeUndefined();
  });
  it("при «+ Английский» на «Курсе» модуль греческого курса возвращает греческий", async () => {
    await setCurrentLanguage("en", db);
    expect(await shelfLanguage(db)).toBe("en");
    await follow("greek-a2");
    await vi.waitFor(async () => expect(await shelfLanguage(db)).toBe("el"));
  });
  it("«Все тексты» на листе «Чтение» выбирает язык курса листа", async () => {
    await installLesson("e01-1", db, memoryFetcher(built));
    await setCurrentLanguage("el", db);
    const view = {
      reading: { id: "r-e01", title: "A text", words: 40 },
      moduleId: "e01",
      module: { number: 1, title: "Work" },
      after: { id: "e01-1", title: "Work", position: 0 },
      open: true,
    } as unknown as ReadingView;
    const readings: CourseReadings = { open: [view], unread: [view], closed: 0, pending: 0 };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <MemoryRouter>
          <ReadingSheet courseId="english" readings={readings} primary={false} />
        </MemoryRouter>,
      ),
    );
    await act(async () => {
      container.querySelector<HTMLAnchorElement>("[data-testid=reading-all]")!.click();
      await vi.waitFor(async () => expect(await currentLanguage(db)).toBe("en"));
    });
    container.remove();
  });
});
