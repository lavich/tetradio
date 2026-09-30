// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScheduleCard } from "../src/features/lessons/ScheduleCard";
import type { Course } from "../src/domain/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saved: { id: string; patch: Record<string, unknown> }[] = [];
vi.mock("../src/storage/ops", () => ({
  saveCourseTempo: (id: string, patch: Record<string, unknown>) => {
    saved.push({ id, patch });
    return Promise.resolve();
  },
}));

const course = (lessonHour: number): Course => ({
  id: "c1",
  title: "Курс",
  origin: "content",
  subscribed: true,
  schedule: { startDate: "2026-09-14", weekdays: [1, 4], lessonHour },
  newItemsPerDay: 12,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
});

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  saved.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

const click = (element: Element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === label)!;

const openEditor = (hour: number) => {
  act(() => {
    root.render(<ScheduleCard course={course(hour)} today="2026-09-15" />);
  });
  click(button("Изменить расписание"));
};

it("сохраняет час занятия вместе с днями недели", () => {
  openEditor(9);
  click(button("Ср"));
  act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(saved).toHaveLength(1);
  expect(saved[0].patch.schedule).toEqual({ startDate: "2026-09-14", weekdays: [1, 3, 4], lessonHour: 9 });
});

it("показывает час занятия и список из 24 значений", () => {
  openEditor(9);
  expect(host.textContent).toContain("09:00");
  click(host.querySelector("[data-slot='select-trigger']")!);
  const options = [...document.querySelectorAll("[data-slot='select-item']")];
  expect(options).toHaveLength(24);
  expect(options[0].textContent).toBe("00:00");
  expect(options[23].textContent).toBe("23:00");
});
