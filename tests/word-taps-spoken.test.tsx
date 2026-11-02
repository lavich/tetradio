// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WordMark } from "../src/content/schema";
import type { TapCard } from "../src/storage/course";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const playText = vi.hoisted(() => vi.fn(() => Promise.resolve("played")));
vi.mock("../src/shared/audio", () => ({ playText }));

const { Marked, WordTaps } = await import("../src/features/course/WordTaps");
const { Explanation } = await import("../src/features/course/blocks/Explanation");

const cards = new Map<string, TapCard>([
  ["w", { ref: "w", greek: "σηκώνομαι", russian: "вставать", audioAssetId: "snd-w" }],
]);
const mark = (start: number, length: number): WordMark => ({ start, length, ref: "w", kind: "lesson", first: false });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  playText.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (text: string, spellForm?: boolean) =>
  act(() =>
    root.render(
      <WordTaps marks={{}} cards={cards} page={0}>
        <Marked text={text} marks={[mark(0, text.length)]} spellForm={spellForm} />
      </WordTaps>,
    ),
  );
const tap = () =>
  act(async () => {
    host.querySelector<HTMLElement>("[role=button][aria-haspopup]")!.click();
  });

describe("озвучка нажатого слова", () => {
  it("в обычном тексте нажатая форма звучит словом карточки", async () => {
    render("σηκώνεσαι");
    await tap();
    expect(playText).toHaveBeenCalledWith("σηκώνομαι", "snd-w", expect.anything());
  });

  it("в таблице форм звучит написанная форма без записи карточки", async () => {
    render("σηκώνεσαι", true);
    await tap();
    expect(playText).toHaveBeenCalledWith("σηκώνεσαι", undefined, expect.anything());
  });

  it("в таблице форм слово карточки звучит её записью", async () => {
    render("σηκώνομαι", true);
    await tap();
    expect(playText).toHaveBeenCalledWith("σηκώνομαι", "snd-w", expect.anything());
  });

  it.each(["Σηκώνομαι", "σηκώνομαι;", "ΣΗΚΏΝΟΜΑΙ"])("в таблице «%s» звучит записью карточки", async (cell) => {
    render(cell, true);
    await tap();
    expect(playText).toHaveBeenCalledWith("σηκώνομαι", "snd-w", expect.anything());
  });

  it("в таблице слово без артикля звучит записью карточки с артиклем", async () => {
    cards.set("n", { ref: "n", greek: "ο φίλος", russian: "друг", audioAssetId: "snd-n" });
    act(() =>
      root.render(
        <WordTaps marks={{}} cards={cards} page={0}>
          <Marked text="φίλος" marks={[{ ...mark(0, 5), ref: "n" }]} spellForm />
        </WordTaps>,
      ),
    );
    await tap();
    expect(playText).toHaveBeenCalledWith("ο φίλος", "snd-n", expect.anything());
  });

  it("в таблице объяснения звучит форма, а в абзаце того же блока слово карточки", async () => {
    const block = {
      type: "explanation" as const,
      id: "b",
      body: "σηκώνεσαι",
      table: { rows: [["σηκώνεσαι"]] },
    };
    act(() =>
      root.render(
        <WordTaps marks={{ b: { body: [mark(0, 9)], "table.0.0": [mark(0, 9)] } }} cards={cards} page={0}>
          <Explanation block={block} />
        </WordTaps>,
      ),
    );
    const [inBody, inTable] = host.querySelectorAll<HTMLElement>("[role=button][aria-haspopup]");
    await act(async () => inTable.click());
    expect(playText).toHaveBeenLastCalledWith("σηκώνεσαι", undefined, expect.anything());
    await act(async () => inBody.click());
    expect(playText).toHaveBeenLastCalledWith("σηκώνομαι", "snd-w", expect.anything());
  });

  it("«Ещё раз» повторяет написанную форму", async () => {
    render("σηκώνεσαι", true);
    await tap();
    playText.mockClear();
    await act(async () => {
      document.querySelector<HTMLElement>("[aria-label='Ещё раз']")!.click();
    });
    expect(playText).toHaveBeenCalledWith("σηκώνεσαι", undefined, expect.anything());
  });
});
