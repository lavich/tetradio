// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WordScreen } from "../src/features/words/WordScreen";
import { SharedWordScreen } from "../src/features/words/SharedWordScreen";
import { refreshCatalog, resetCatalogPhase, resetPreviews, useFetcher } from "../src/content/client";
import { NO_SOUND } from "../src/domain/learning";
import type { Word } from "../src/domain/types";
import { db, indexWord } from "../src/storage/db";
import { useWordExercises } from "../src/features/words/word-exercises";
import { installLessons, memoryFetcher } from "./helpers/content";

/** Здесь нет ни синтезатора, ни файлов звука: аудированию и пониманию на слух не на чем звучать. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  resetCatalogPhase();
  resetPreviews();
  useFetcher(memoryFetcher());
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
          <Route path="/words/:id" element={<WordScreen />} />
          <Route path="/share/word/:id" element={<SharedWordScreen />} />
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
const choice = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label='${label}: пройти']`);

describe("блок «Упражнения» на экране слова", () => {
  it("без файла и голоса аудирование и понимание на слух выключены с причиной, остальное доступно", async () => {
    await installLessons(db, ["lesson-3-4"]);
    await mount("/words/w34-03");
    await until(() => !!choice("Написание") && !choice("Написание")!.disabled, "блок упражнений");
    expect(choice("Узнавание")!.disabled).toBe(false);
    expect(choice("Сборка из слогов")!.disabled).toBe(false);
    expect(choice("Аудирование")!.disabled).toBe(true);
    expect(choice("Понимание на слух")!.disabled).toBe(true);
    expect(text().split(NO_SOUND)).toHaveLength(3);
  });
  it("у удалённого слова блока нет", async () => {
    await installLessons(db, ["lesson-3-4"]);
    await db.words.update("w34-03", { deletedAt: "2026-01-01T00:00:00.000Z" });
    await mount("/words/w34-03");
    await until(() => text().includes("Потренировать слово"), "экран слова");
    expect(host.querySelector("[data-testid=word-exercises]")).toBeNull();
  });
  it("на карточке по ссылке блока нет", async () => {
    await refreshCatalog();
    await mount("/share/word/w34-03");
    await until(() => text().includes("Слово из урока"), "карточка по ссылке");
    expect(host.querySelector("[data-testid=word-exercises]")).toBeNull();
    expect(text()).not.toContain("Упражнения");
  });
});

describe("доступность упражнений по соседям слова", () => {
  const iso = "2026-09-15T09:00:00.000Z";
  const w = (id: string, greek: string, russian: string): Word => ({
    id,
    greek,
    russian,
    ipa: "",
    segments: [],
    examples: [],
    verified: false,
    createdAt: iso,
    updatedAt: iso,
  });
  // Словарь больше пула: пул берётся порциями. У всех слов вне урока один перевод, поэтому им вариантов не хватает.
  const fillers = Array.from({ length: 50 }, (_, i) => w(`a${String(i).padStart(2, "0")}`, `το λέξη${i}`, "одно"));
  const lesson = [
    w("z0", "η γάτα", "кошка"),
    w("z1", "ο σκύλος", "собака"),
    w("z2", "το ψάρι", "рыба"),
    w("z3", "το πουλί", "птица"),
  ];
  function Probe({ word }: { word: Word }) {
    const options = useWordExercises(word);
    return <output>{options ? `${word.id}:${options.recognition.available ? "да" : "нет"}` : "…"}</output>;
  }
  afterEach(() => vi.restoreAllMocks());

  it("при переходе на другое слово доступность считается по его соседям, а не по соседям прошлого", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // пул — только первые слова по id, соседи урока в него не попадают
    await db.words.bulkAdd([...fillers, ...lesson].map(indexWord));
    await db.lessonItems.bulkAdd(
      lesson.map((x, position) => ({
        lessonId: "animals",
        unitKey: JSON.stringify(["word", x.id]),
        ref: { kind: "word" as const, id: x.id },
        position,
      })),
    );
    root = createRoot(host);
    const show = (word: Word) => act(async () => root!.render(<Probe word={word} />));
    await show(lesson[0]);
    await until(() => text() === "z0:да", "узнавание слова урока");
    await show(fillers[0]);
    await until(() => text() !== "z0:да" && text() !== "…", "пересчёт для нового слова");
    expect(text()).toBe("a00:нет");
    await show(lesson[0]);
    await until(() => text() === "z0:да", "возврат к слову урока");
  });
});
