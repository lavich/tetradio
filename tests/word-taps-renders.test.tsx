// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BlockMarks } from "../src/content/schema";
import type { TapCard } from "../src/storage/course";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/shared/language", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/shared/language")>();
  return {
    ...original,
    useProfile: () => {
      renders.count++;
      return original.useProfile();
    },
  };
});
vi.mock("../src/shared/audio", () => ({ playText: () => Promise.resolve("played") }));

const { Marked, TapHint, WordTaps } = await import("../src/features/course/WordTaps");

const WORDS = 200;
const text = Array.from({ length: WORDS }, () => "λέξη").join(" ");
const marks: BlockMarks = {
  b: {
    text: Array.from({ length: WORDS }, (_, index) => ({
      start: index * 5,
      length: 4,
      ref: "w",
      kind: "lesson" as const,
      first: false,
    })),
  },
};
const cards = new Map<string, TapCard>([["w", { ref: "w", greek: "λέξη", russian: "слово" }]]);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tap = (index: number) =>
  act(async () => {
    host.querySelectorAll<HTMLElement>("[role=button][aria-haspopup]")[index].click();
  });

describe("нажатие на слово", () => {
  it("не перерисовывает остальные слова страницы, и на первом нажатии с невиданной подсказкой тоже", async () => {
    act(() =>
      root.render(
        <WordTaps marks={marks} cards={cards} page={0}>
          <TapHint />
          <p>
            <Marked text={text} marks={marks.b.text} />
          </p>
        </WordTaps>,
      ),
    );
    expect(host.querySelectorAll("[role=button][aria-haspopup]")).toHaveLength(WORDS);
    expect(host.querySelector("[role=note]")).not.toBeNull();

    renders.count = 0;
    await tap(0);
    expect(renders.count).toBeLessThan(10);
    expect(host.querySelector("[role=note]")).toBeNull();

    renders.count = 0;
    await tap(1);
    expect(renders.count).toBeLessThan(10);
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
  });
});
