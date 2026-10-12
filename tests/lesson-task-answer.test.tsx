// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MistakeItem, SessionItem } from "../src/domain/types";
import { LessonTask } from "../src/features/learning/exercises/LessonTask";

const playText = vi.hoisted(() => vi.fn(async () => "file" as const));
vi.mock("../src/shared/audio", async (original) => ({
  ...(await original<typeof import("../src/shared/audio")>()),
  playText,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;

const ANSWER = "Η αδελφή μου είναι τριάντα χρονών.";
const mistake: MistakeItem = {
  id: "m03-3/translate/q2",
  lessonId: "m03-3",
  format: "text",
  instruction: "Напишите по-гречески.",
  prompt: "Моей сестре тридцать лет.",
  answer: [ANSWER],
  audioAssetId: "answer-m03-3-translate-q2",
};
const item: SessionItem = {
  id: "i1",
  ref: { kind: "mistake", id: mistake.id },
  unitKey: `mistake:${mistake.id}`,
  card: { kind: "mistake", mistake },
  type: "item",
  options: [],
  isNew: false,
  mode: "practice",
  expectedVersion: 0,
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  playText.mockClear();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const answerWith = async (autoSpeak: boolean) => {
  await act(async () =>
    root.render(<LessonTask item={item} onAnswer={async () => true} onNext={() => undefined} autoSpeak={autoSpeak} />),
  );
  const unknown = [...host.querySelectorAll("button")].find((button) => button.textContent === "Не знаю")!;
  await act(async () => unknown.click());
};

describe("верный ответ задания урока вслух", () => {
  it("после ответа видно предложение с кнопкой озвучки записи", async () => {
    await answerWith(false);
    expect(host.querySelector("[data-testid=reveal]")?.textContent).toContain(ANSWER);
    const listen = host.querySelector<HTMLButtonElement>('[aria-label="Послушать ответ"]')!;
    await act(async () => listen.click());
    expect(playText).toHaveBeenCalledWith(ANSWER, "answer-m03-3-translate-q2", expect.anything());
  });
  it("с автоозвучкой ответ звучит сам один раз", async () => {
    await answerWith(true);
    expect(playText).toHaveBeenCalledTimes(1);
  });
  it("без автоозвучки сам не звучит", async () => {
    await answerWith(false);
    expect(playText).not.toHaveBeenCalled();
  });
});
