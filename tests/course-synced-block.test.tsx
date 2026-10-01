// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ExerciseBlock } from "../src/content/course";
import type { BlockProgress } from "../src/domain/types";
import { Exercise } from "../src/features/course/blocks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const block: ExerciseBlock = {
  type: "exercise",
  id: "forms",
  instruction: "Выберите форму.",
  format: "choice",
  items: [
    { id: "q1", prompt: "Εγώ ___", options: ["είμαι", "είσαι"], answer: ["είμαι"] },
    { id: "q2", prompt: "Εσύ ___", options: ["είμαι", "είσαι"], answer: ["είσαι"] },
  ],
};
const row = (over: Partial<BlockProgress>): BlockProgress => ({
  key: "m01-1/forms",
  lessonId: "m01-1",
  blockId: "forms",
  done: true,
  updatedAt: "2026-09-16T09:00:00.000Z",
  ...over,
});

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (progress: BlockProgress) =>
  act(() => root.render(<Exercise block={block} progress={progress} save={async () => undefined} />));

describe("задание, выполненное на другом устройстве", () => {
  it("показывает полученный счёт без локальных ответов и не помечает пункты неверными", () => {
    render(row({ score: { correct: 1, almost: 1, total: 2 } }));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("2 из 2 · на другом устройстве");
    expect(host.textContent).not.toContain("Верно:");
    expect(host.textContent).toContain("Ещё раз");
  });
  it("без счёта — просто «выполнено»", () => {
    render(row({}));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Выполнено · на другом устройстве");
  });
  it("с локальными ответами счёт и разбор считаются по ним, как раньше", () => {
    render(row({ answers: { q1: "είμαι", q2: "είμαι" }, score: { correct: 1, almost: 0, total: 2 } }));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 из 2");
    expect(host.textContent).toContain("Верно: είσαι");
  });
});
