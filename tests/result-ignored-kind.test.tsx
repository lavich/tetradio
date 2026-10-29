// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createEmptyCard, State } from "ts-fsrs";
import { unitKey, wordRef } from "../src/domain/refs";
import type { ReviewEvent, Session, SessionItem } from "../src/domain/types";
import { ResultScreen } from "../src/features/learning/ResultScreen";
import { db } from "../src/storage/db";
import { install, NOW, seedCatalog, wordOf } from "./helpers/language-db";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 20_000 });
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;

let root: Root | null = null;
let host: HTMLElement;
const MISTAKE = { kind: "mistake" as const, id: "travel-1/b/q1" };

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedCatalog(db);
  await install(db, "travel", { due: 1 });
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const item = (id: string, over: Partial<SessionItem>): SessionItem =>
  ({
    id,
    options: [],
    isNew: false,
    mode: "scheduled",
    expectedVersion: 1,
    ...over,
  }) as SessionItem;
const wrong = (itemId: string, ref: ReviewEvent["ref"], snapshot: ReviewEvent["snapshot"]): ReviewEvent => ({
  id: `e-${itemId}`,
  sessionId: "old",
  itemId,
  ref,
  unitKey: unitKey(ref),
  snapshot,
  type: "recognition",
  mode: "scheduled",
  rating: 1,
  correct: false,
  answer: "",
  createdAt: NOW.toISOString(),
  localDate: "2026-10-08",
  responseTimeMs: 1000,
});

const SOON = new Date("2099-01-01T09:00:00Z");
const wordItem = (index: number): SessionItem => {
  const word = wordOf("travel", index);
  return item(`old-w${index}`, {
    ref: wordRef(word.id),
    unitKey: unitKey(wordRef(word.id)),
    card: { kind: "word", word },
    type: "recognition",
    eventId: `e-old-w${index}`,
  });
};
const mistakeItem = (n: number): SessionItem => {
  const ref = { ...MISTAKE, id: `travel-1/b/q${n}` };
  return item(`old-m${n}`, {
    ref,
    unitKey: unitKey(ref),
    card: {
      kind: "mistake",
      mistake: {
        id: ref.id,
        lessonId: "travel-1",
        format: "text",
        instruction: "Впишите",
        prompt: `Вопрос урока ${n}`,
        answer: ["ответ"],
      },
    },
    type: "item",
    eventId: `e-old-m${n}`,
  });
};
const stateOf = (ref: ReviewEvent["ref"], due: Date) => ({
  unitKey: unitKey(ref),
  ref,
  introducedAt: "2026-10-01T09:00:00Z",
  version: 1,
  card: { ...createEmptyCard(NOW), due, state: State.Learning },
});

describe("итог занятия прежней версии с ошибкой урока", () => {
  it("«Повторить ошибки» и «Вернутся…» строятся только по словам; полоса считает все ответы", async () => {
    const items = [wordItem(0), mistakeItem(1), wordItem(1), mistakeItem(2)];
    await db.sessions.add({
      id: "old",
      createdAt: NOW.toISOString(),
      planDate: "2026-10-08",
      items,
      index: items.length,
      status: "done",
      activeTimeMs: 2000,
      courseId: "travel",
      language: "en",
    } satisfies Session);
    await db.events.bulkAdd(
      items.map((entry) =>
        wrong(
          entry.id,
          entry.ref,
          entry.card.kind === "word"
            ? { greek: entry.card.word.greek, russian: entry.card.word.russian }
            : { prompt: entry.card.kind === "mistake" ? entry.card.mistake.prompt : "", answer: "ответ" },
        ),
      ),
    );
    const past = new Date("2026-10-07T09:00:00Z");
    await db.cardStates.bulkPut([
      stateOf(items[1].ref, past),
      stateOf(items[2].ref, SOON),
      stateOf(items[3].ref, SOON),
    ]);
    root = createRoot(host);
    act(() =>
      root!.render(
        <MemoryRouter initialEntries={["/session/result/old"]}>
          <Routes>
            <Route path="/session/result/:id" element={<ResultScreen />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    const again = () =>
      [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Повторить ошибки"));
    for (let i = 0; i < 300 && !again(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(again()?.textContent).toBe("Повторить ошибки (1)");
    expect(host.querySelector('[data-testid="result-count"]')?.textContent).toContain("0 из 4 без ошибок");
    const back = [...host.querySelectorAll("p")].filter((node) => node.textContent?.startsWith("Верн"));
    expect(back).toHaveLength(1);
    expect(back[0].textContent).toContain(wordOf("travel", 1).greek);
    expect(back[0].textContent).not.toContain("Вопрос урока");
  });
});
