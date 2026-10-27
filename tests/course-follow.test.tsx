// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildContent } from "../content/build";
import { installLesson, refreshCatalog } from "../src/content/client";
import { useFollowCourse } from "../src/shared/courses";
import { currentLanguage, setCurrentLanguage, shelfLanguage } from "../src/storage/courses";
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
});
