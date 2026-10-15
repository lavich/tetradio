// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createEmptyCard } from "ts-fsrs";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SessionScreen } from "../src/features/learning/SessionScreen";
import { SettingsScreen } from "../src/features/progress/SettingsScreen";
import { db } from "../src/storage/db";
import { dexieSource, loadSettings } from "../src/storage/queries";
import { makeSession } from "../src/domain/learning";
import { installCompleted } from "./helpers/content";

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver)
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

let root: Root | null = null;
let host: HTMLElement;
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const mount = (screen: React.ReactNode) => {
  root = createRoot(host);
  act(() => root!.render(<MemoryRouter>{screen}</MemoryRouter>));
};
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error(`не дождались: ${what}\n${host.textContent}`);
}

describe("настройки", () => {
  it("нажатие до загрузки настроек сохраняется и не затирает остальные настройки", async () => {
    await db.settings.put({ id: "settings", errorReports: false, autoSpeak: true });
    mount(<SettingsScreen />);
    const speak = host.querySelector<HTMLInputElement>('[aria-label="Озвучивать автоматически"]')!;
    await act(async () => speak.click()); // сразу, не дожидаясь чтения базы
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(speak.checked).toBe(false);
    expect(await loadSettings()).toMatchObject({ autoSpeak: false, errorReports: false });
  });
});

describe("занятие без активной сессии", () => {
  it("показывает «Активного занятия нет», а не вечный скелет", async () => {
    mount(<SessionScreen />);
    await until(() => host.textContent!.includes("Активного занятия нет."), "пустое состояние");
  });
});

describe("занятие после применения версии из облака", () => {
  it("ответ на карточку с изменившимся состоянием даёт обычную обратную связь и ведёт дальше", async () => {
    await installCompleted(db, ["mech-1"]);
    const made = await makeSession({ source: dexieSource(db), now: new Date(), random: () => 0.42 });
    const first = made.items.findIndex((entry) => entry.type === "recognition");
    const item = made.items[first];
    await db.sessions.add({
      ...made,
      introducedKeys: made.items.map((entry) => entry.unitKey),
      items: made.items.map((entry, index) => (index < first ? { ...entry, skipped: true } : entry)),
      index: first,
    });
    // Облако принесло состояние карточки новее того, что ожидает пункт занятия.
    await db.cardStates.put({
      unitKey: item.unitKey,
      ref: item.ref,
      introducedAt: new Date().toISOString(),
      version: item.expectedVersion + 1,
      card: createEmptyCard(),
    });
    mount(<SessionScreen />);
    await until(() => !!host.querySelector('[data-testid="option"]'), "варианты ответа");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="option"]')!.click());
    await until(() => !!host.querySelector('[role="status"]'), "обратная связь");
    expect(host.textContent).not.toMatch(/Не удалось|другой вкладке/);
    const next = [...host.querySelectorAll("button")].find((button) => button.textContent === "Далее")!;
    await act(async () => next.click());
    await until(() => host.textContent!.includes(`${first + 2} из `), "следующее упражнение");
    expect((await db.events.toArray()).map((event) => event.itemId)).toEqual([item.id]);
    expect((await db.cardStates.get(item.unitKey))!.version).toBe(item.expectedVersion + 2);
  });
});
