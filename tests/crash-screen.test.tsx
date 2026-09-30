// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Recovery } from "../src/app/Recovery";
import { pendingReports, resetReporting } from "../src/reporting/reporting";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const SECRET = "σπίτι — дом, ответ: спити";
function Thrower(): never {
  throw new Error(SECRET);
}

let root: Root | null = null,
  container: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetReporting();
  vi.restoreAllMocks();
});

describe("экран сбоя", () => {
  it("компонент, упавший при рендере, даёт экран сбоя с перезапуском и диагностикой без учебных данных; отчёт уходит категорией ui", async () => {
    resetReporting({ dsn: "https://key@o1.ingest.sentry.io/1", loader: () => Promise.reject(new Error("не в тесте")) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
      configurable: true,
    });
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <Recovery>
          <Thrower />
        </Recovery>,
      );
    });
    const screen = container.querySelector('[data-testid="recovery-failed"]');
    expect(screen).not.toBeNull();
    expect(screen!.textContent).toContain("Не удалось показать экран");
    const buttons = Array.from(container.querySelectorAll("button")).map((button) => button.textContent);
    expect(buttons).toEqual(["Перезапустить", "Скопировать диагностику"]);
    const reports = pendingReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].category).toBe("ui");
    expect(reports[0].extra?.componentStack).toContain("Thrower");
    const copy = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Скопировать диагностику",
    )!;
    await act(async () => {
      copy.click();
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^Lexi \d+\.\d+\.\d+ \(/);
    expect(written[0]).toContain("Среда: веб");
    expect(written[0]).toContain(`Отчёт: ${reports[0].id}`);
    expect(written[0]).toContain("Ошибка: Error");
    expect(written[0]).toMatch(/Время: \d{4}-\d{2}-\d{2}T/);
    for (const word of ["σπίτι", "дом", "спити"]) expect(written[0]).not.toContain(word);
    expect(container.textContent).toContain("Диагностика скопирована");
  });
  it("без буфера обмена диагностика показывается на экране для ручного копирования", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <Recovery>
          <Thrower />
        </Recovery>,
      );
    });
    const copy = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Скопировать диагностику",
    )!;
    await act(async () => {
      copy.click();
    });
    const shown = container.querySelector('[data-testid="diagnostics"]');
    expect(shown?.textContent).toContain("Отчёт: не отправлен"); // без адреса приёма отчёта нет
    expect(shown?.textContent).not.toContain("σπίτι");
  });
});
