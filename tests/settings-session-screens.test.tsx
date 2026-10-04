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
const field = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;
const type = (input: HTMLInputElement, text: string) =>
  act(async () => {
    // eslint-disable-next-line typescript/unbound-method -- сеттер прототипа вызывается через .call, привязка задаётся явно
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("настройки", () => {
  beforeEach(async () => {
    await db.courses.put({
      id: "a2",
      title: "Курс",
      newItemsPerDay: 6,
      updatedAt: "",
    });
  });
  it("дневной лимит читается из курса и сохраняется в курс", async () => {
    mount(<SettingsScreen />);
    await until(() => field("daily").value === "6", "лимит из курса");
    await type(field("daily"), "12");
    await act(async () => host.querySelector("form")!.requestSubmit());
    await until(() => !!host.querySelector('[role="status"]'), "сохранено");
    expect((await db.courses.get("a2"))?.newItemsPerDay).toBe(12);
  });
  it("переключатель озвучки не сбрасывает несохранённые правки формы", async () => {
    mount(<SettingsScreen />);
    await until(() => field("daily").value === "6", "форма заполнена");
    await type(field("daily"), "12");
    await type(field("size"), "15");
    const speak = host.querySelector<HTMLInputElement>('[aria-label="Озвучивать автоматически"]')!;
    const before = (await loadSettings()).autoSpeak;
    await act(async () => speak.click());
    await until(() => speak.checked !== before, "переключатель");
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect((await loadSettings()).autoSpeak).toBe(!before);
    expect(field("daily").value).toBe("12");
    expect(field("size").value).toBe("15");
  });
});

describe("занятие без активной сессии", () => {
  it("показывает «Активного занятия нет», а не вечный скелет", async () => {
    mount(<SessionScreen />);
    await until(() => host.textContent!.includes("Активного занятия нет."), "пустое состояние");
  });
});
