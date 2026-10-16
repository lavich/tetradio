// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CourseLesson } from "../src/storage/course";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../src/domain/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/domain/time")>()),
  deviceTimezone: () => "Asia/Nicosia",
}));
const { LessonSummary } = await import("../src/features/course/LessonSummary");

let root: Root | undefined;
afterEach(() => act(() => root?.unmount()));

const render = async (updatedAt: string) => {
  const container = document.createElement("div");
  root = createRoot(container);
  const lesson = {
    id: "l1",
    title: "Урок 1.1",
    kind: "lesson",
    moduleId: "m1",
    position: 0,
    blocks: [],
    lesson: { id: "l1", title: "Урок 1.1", completed: true, updatedAt },
    marks: {},
    cards: new Map(),
  } as unknown as CourseLesson;
  const noop = () => undefined;
  await act(async () =>
    root!.render(
      <LessonSummary
        lesson={lesson}
        progress={new Map()}
        passShare={undefined}
        pages={[]}
        numbering={new Map()}
        items={[]}
        mistakes={0}
        next={null}
        reading={null}
        withList={false}
        problem=""
        practice={noop}
        go={noop}
        openNext={noop}
        openReading={noop}
        toModule={noop}
      />,
    ),
  );
  return container.textContent ?? "";
};

it("урок, пройденный в 00:30, подписан вчерашним учебным днём, в 04:30 — своим", async () => {
  expect(await render("2026-10-15T21:30:00Z")).toContain("15 октября · Урок 1.1");
  act(() => root?.unmount());
  root = undefined;
  expect(await render("2026-10-16T01:30:00Z")).toContain("16 октября · Урок 1.1");
});
