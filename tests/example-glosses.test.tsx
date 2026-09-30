// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { Example, Word } from "../src/domain/types";
import { db, indexWord } from "../src/storage/db";
import { ExampleBox } from "../src/features/words/WordCardView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const example: Example = {
  greek: "Το σπίτι μας είναι μεγάλο.",
  russian: "Наш дом большой.",
  target: "σπίτι",
  glosses: [
    { start: 3, length: 5, russian: "дом", wordId: "w-house" },
    { start: 9, length: 3, russian: "наш" },
    { start: 13, length: 5, russian: "есть" },
    { start: 19, length: 6, russian: "большой", wordId: "w-big" },
  ],
};
const word = (id: string, over: Partial<Word> = {}): Word => ({
  id,
  greek: "μεγάλος",
  russian: "большой",
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: "",
  updatedAt: "",
  ...over,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await db.words.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = async (props: Parameters<typeof ExampleBox>[0]) => {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ExampleBox {...props} />
      </MemoryRouter>,
    );
  });
};
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("p button")].filter((b) => !b.ariaLabel);
const press = async (text: string) => {
  const button = buttons().find((b) => b.textContent === text)!;
  await act(async () => button.click());
  // Связанная карточка читается из базы после нажатия: даём живому запросу ответить.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
};
const line = () => host.querySelector('[data-testid="example-gloss"]')!;

describe("перевод слов примера", () => {
  it("размеченные отрезки — кнопки, слово-цель выделено, строка меняется и скрывается", async () => {
    await render({ example });
    expect(buttons().map((b) => b.textContent)).toEqual(["σπίτι", "μας", "είναι", "μεγάλο"]);
    expect(host.querySelector("p")!.nextElementSibling!.textContent).toBe("Το σπίτι μας είναι μεγάλο.");
    expect(buttons()[0].querySelector("span")!.textContent).toBe("σπίτι");
    expect(line().getAttribute("aria-live")).toBe("polite");
    expect(line().textContent).toBe("");
    await press("σπίτι");
    expect(line().textContent).toBe("σπίτι — дом");
    await press("είναι");
    expect(line().textContent).toBe("είναι — есть");
    expect(buttons()[2].getAttribute("aria-expanded")).toBe("true");
    await press("είναι");
    expect(line().textContent).toBe("");
  });
  it("пример без разметки не нажимается и строки перевода нет", async () => {
    await render({ example: { ...example, glosses: undefined } });
    expect(buttons()).toHaveLength(0);
    expect(line()).toBeNull();
    expect(host.querySelector("span")!.textContent).toBe("σπίτι");
  });
  it("в карточке слова ссылка на установленную карточку открывает её", async () => {
    await db.words.put(indexWord(word("w-big")));
    await render({ example, linkFrom: "w-house" });
    await press("μεγάλο");
    expect(line().textContent).toBe("μεγάλο — большой Открыть карточку");
    expect(line().querySelector("a")!.getAttribute("href")).toBe("/words/w-big");
  });
  it("карточки нет на устройстве или она удалена — только перевод", async () => {
    await render({ example, linkFrom: "w-house" });
    await press("μεγάλο");
    expect(line().textContent).toBe("μεγάλο — большой");
    await db.words.put(indexWord(word("w-big", { deletedAt: "2026-09-20T00:00:00Z" })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(line().querySelector("a")).toBeNull();
  });
  it("ссылка на ту же карточку действия не даёт", async () => {
    await db.words.put(indexWord(word("w-house", { greek: "το σπίτι", russian: "дом" })));
    await render({ example, linkFrom: "w-house" });
    await press("σπίτι");
    expect(line().textContent).toBe("σπίτι — дом");
    expect(line().querySelector("a")).toBeNull();
  });
  it("без карточки-источника (в тренировке) строка показывает только перевод", async () => {
    await db.words.put(indexWord(word("w-big")));
    await render({ example });
    await press("μεγάλο");
    expect(line().textContent).toBe("μεγάλο — большой");
    expect(line().querySelector("a")).toBeNull();
  });
});
