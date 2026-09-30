// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useNow } from "../src/shared/clock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null,
  container: HTMLElement | null = null;
const seen: number[] = [];
function Clock() {
  const now = useNow(60000);
  seen.push(now.getTime());
  return <span>{now.toISOString()}</span>;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  Object.defineProperty(document, "hidden", { value: state === "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T19:29:00Z"));
  seen.length = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  setVisibilityQuiet("visible");
});
function setVisibilityQuiet(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  Object.defineProperty(document, "hidden", { value: state === "hidden", configurable: true });
}

describe("часы приложения в фоне", () => {
  it("уход в фон и тики интервала в фоне не двигают время, возврат на экран — двигает", async () => {
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => {
      root!.render(<Clock />);
    });
    const start = seen.at(-1)!;
    vi.setSystemTime(start + 5000);
    await act(async () => {
      setVisibility("hidden");
    });
    expect(seen.at(-1)).toBe(start);
    await act(async () => {
      vi.advanceTimersByTime(3 * 60000);
    });
    expect(seen.at(-1)).toBe(start);
    await act(async () => {
      setVisibility("visible");
    });
    expect(seen.at(-1)).toBeGreaterThanOrEqual(start + 3 * 60000);
  });
  it("на видимом экране интервал двигает время как раньше", async () => {
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => {
      root!.render(<Clock />);
    });
    const start = seen.at(-1)!;
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(seen.at(-1)).toBe(start + 60000);
  });
});
