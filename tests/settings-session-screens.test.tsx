// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SessionScreen } from "../src/features/learning/SessionScreen";
import { SettingsScreen } from "../src/features/progress/SettingsScreen";
import { db } from "../src/storage/db";
import { loadSettings } from "../src/storage/queries";

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
