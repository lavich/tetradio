// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Греческий голос нужен аудированию и пониманию на слух; синтезатор подменяется до загрузки модулей.
vi.hoisted(() => {
  const voices = [{ lang: "el-GR", name: "Greek test" }];
  (globalThis as Record<string, unknown>).speechSynthesis = {
    speaking: false,
    pending: false,
    getVoices: () => voices,
    speak: (utterance: { onstart?: () => void }) => setTimeout(() => utterance.onstart?.(), 1),
    cancel: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = class {
    constructor(public text: string) {}
  };
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WordExerciseScreen } from "../src/features/words/WordExerciseScreen";
import { WordScreen } from "../src/features/words/WordScreen";
import { resetCatalogPhase } from "../src/content/client";
import { splitWriting } from "../src/domain/syllables";
import { WORD_EXERCISES, type WordExerciseType } from "../src/domain/learning";
import { wordRef } from "../src/domain/refs";
import { db, TABLES } from "../src/storage/db";
import { DIRTY_KEY } from "../src/storage/ops";
import { startSession } from "../src/features/learning/session-actions";
import { syncEvents } from "../src/sync/events";
import { installLessons } from "./helpers/content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;

const GREEK = "η κατσαρόλα",
  RUSSIAN = "кастрюля";
let root: Root | null = null;
let host: HTMLElement;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  resetCatalogPhase();
  await installLessons(db, ["lesson-3-4"]);
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

async function mount(path: string) {
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/words/:id/exercise/:type" element={<WordExerciseScreen />} />
          <Route path="/words/:id" element={<p>экран слова</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
const text = () => host.textContent ?? "";
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error(`не дождались: ${what}\n${text()}`);
}
const buttons = () => [...host.querySelectorAll("button")];
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label);
const click = async (element: Element | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
};
const answered = () => !!button("Ещё раз");

/** Ответ в упражнении любого вида: `right` — верный, иначе заведомо неверный. */
async function respond(type: WordExerciseType, right: boolean) {
  if (type === "spelling") {
    const input = host.querySelector<HTMLInputElement>("input[aria-label='Твой ответ по-гречески']")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, right ? GREEK : "λάθος");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Проверить"));
  } else if (type === "assembly") {
    const writing = splitWriting(GREEK);
    const tiles = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=tile]")];
    const order = right ? [writing.article!, ...writing.syllables] : tiles.map((tile) => tile.textContent!);
    for (const part of order)
      await click(
        [...host.querySelectorAll<HTMLButtonElement>("[data-testid=tile]")].find(
          (tile) => tile.textContent === part && !tile.disabled,
        ),
      );
    await click(button("Проверить"));
  } else {
    const correct = type === "listening" ? GREEK : RUSSIAN;
    const options = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=option]")];
    await click(options.find((option) => (option.textContent === correct) === right));
  }
  await until(answered, `ответ в ${type}`);
}
async function snapshot() {
  const rows = await Promise.all(
    TABLES.filter((name) => name !== "assets").map(async (name) => [name, await db.table(name).toArray()] as const),
  );
  return Object.fromEntries(rows);
}

describe("упражнение по выбору", () => {
  it("написание без ударения — «Почти» с правильным вариантом, «Ещё раз» сбрасывает ответ", async () => {
    await mount("/words/w34-03/exercise/spelling");
    await until(() => !!host.querySelector("input"), "поле ответа");
    expect(text()).toContain("Без учёта прогресса");
    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "η κατσαρολα");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Проверить"));
    await until(answered, "ответ");
    expect(text()).toContain("Почти");
    expect(text()).toContain(GREEK);
    await click(button("Ещё раз"));
    await until(() => !answered() && !!host.querySelector("input"), "новая попытка");
    expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
  });

  it("после ошибки остаётся то же упражнение, без ступени проще", async () => {
    await mount("/words/w34-03/exercise/spelling");
    await until(() => !!host.querySelector("input"), "поле ответа");
    await respond("spelling", false);
    await click(button("Ещё раз"));
    await until(() => !!host.querySelector("input"), "снова написание");
    expect(host.querySelector("[data-testid=tile]")).toBeNull();
    expect(host.querySelector("[data-testid=option]")).toBeNull();
  });

  it("узнавание по «Ещё раз» открывается заново без выбранного ответа", async () => {
    await mount("/words/w34-03/exercise/recognition");
    await until(() => !!host.querySelector("[data-testid=option]"), "варианты");
    await respond("recognition", true);
    await click(button("Ещё раз"));
    await until(() => !answered() && host.querySelectorAll("[data-testid=option]").length === 4, "новые варианты");
    expect(host.querySelector("[data-answer]")).toBeNull();
    expect(text()).toContain(RUSSIAN);
  });

  it("недоступный вид, неизвестный тип и нет слова — сообщение и возврат к слову", async () => {
    await db.words.put({ ...(await db.words.get("w34-03"))!, id: "one", greek: "φως", russian: "свет" });
    await mount("/words/one/exercise/assembly");
    await until(() => text().includes("недоступно"), "недоступная сборка");
    expect(text()).toContain("один слог");
    await click(button("К слову"));
    await until(() => text().includes("экран слова"), "возврат к слову");
    act(() => root!.unmount());
    await mount("/words/w34-03/exercise/magic");
    await until(() => text().includes("Упражнение недоступно"), "неизвестный тип");
    act(() => root!.unmount());
    await mount("/words/w99-99/exercise/spelling");
    await until(() => text().includes("Слово не найдено"), "нет слова");
  });

  it("ни один из пяти видов ничего не записывает: ни событий, ни состояния, ни занятия, ни метки синхронизации", async () => {
    const session = await startSession(new Date(), { refs: [wordRef("w34-03")], mode: "practice" });
    expect(session).toBeTruthy();
    const before = await snapshot();
    const changes: string[] = [];
    const off = syncEvents.on((event) => changes.push(event));
    for (const type of WORD_EXERCISES) {
      await mount(`/words/w34-03/exercise/${type}`);
      await until(() => !!button("Не знаю") || !!button("Проверить"), `упражнение ${type}`);
      await respond(type, true);
      await click(button("Ещё раз"));
      await until(() => !answered(), `новая попытка ${type}`);
      await respond(type, false);
      act(() => root!.unmount());
      root = null;
    }
    off();
    expect(await snapshot()).toEqual(before);
    expect(await db.meta.get(DIRTY_KEY)).toBeUndefined();
    expect(await db.events.count()).toBe(0);
    expect(await db.cardStates.count()).toBe(0);
    expect((await db.sessions.get(session!.id))?.index).toBe(0);
    expect(changes).toEqual([]);
  });
});

describe("блок «Упражнения» на экране слова с голосом", () => {
  it("у слова курса доступны все пять видов, «Пройти» открывает выбранное", async () => {
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <MemoryRouter initialEntries={["/words/w34-03"]}>
          <Routes>
            <Route path="/words/:id" element={<WordScreen />} />
            <Route path="/words/:id/exercise/:type" element={<WordExerciseScreen />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    await until(
      () => host.querySelectorAll("[data-testid=word-exercises] button:not([disabled])").length === 5,
      "пять видов",
    );
    expect(text()).toContain("Без учёта прогресса");
    expect(button("Потренировать слово")).toBeTruthy();
    await click(host.querySelector("[aria-label='Написание: пройти']")!);
    await until(() => !!host.querySelector("input[aria-label='Твой ответ по-гречески']"), "экран написания");
  });
});
