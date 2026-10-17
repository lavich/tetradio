// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LoadingBar } from "../src/app/LoadingBar";
import { trackLoading } from "../src/app/loading";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<LoadingBar />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const shown = () => host.querySelector("[role=status]") !== null;

describe("индикация загрузки экрана", () => {
  it("быстрая загрузка ничего не показывает", async () => {
    let finish: () => void = () => undefined;
    act(() => {
      void trackLoading(new Promise<void>((resolve) => (finish = resolve)));
    });
    await act(async () => vi.advanceTimersByTime(200));
    expect(shown()).toBe(false);
    await act(async () => finish());
    await act(async () => vi.advanceTimersByTime(500));
    expect(shown()).toBe(false);
  });
  it("медленная появляется через 300 мс и уходит с загрузкой", async () => {
    let finish: () => void = () => undefined;
    act(() => {
      void trackLoading(new Promise<void>((resolve) => (finish = resolve)));
    });
    await act(async () => vi.advanceTimersByTime(350));
    expect(shown()).toBe(true);
    await act(async () => finish());
    expect(shown()).toBe(false);
  });
  it("отказ загрузки тоже снимает индикацию", async () => {
    let fail: (error: Error) => void = () => undefined;
    act(() => {
      trackLoading(new Promise<void>((_, reject) => (fail = reject))).catch(() => undefined);
    });
    await act(async () => vi.advanceTimersByTime(350));
    expect(shown()).toBe(true);
    await act(async () => fail(new Error("offline")));
    expect(shown()).toBe(false);
  });
});
