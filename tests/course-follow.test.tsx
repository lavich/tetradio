// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "./helpers/self";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildContent } from "../content/build";
import { installLesson, refreshCatalog } from "../src/content/client";
import { useFollowCourse } from "../src/shared/courses";
import { setCurrentCourse, shelfCourse } from "../src/storage/courses";
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
