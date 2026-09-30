// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Recovery } from "../src/app/Recovery";
import { pendingCrumbs, pendingReports, resetReporting } from "../src/reporting/reporting";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/** Хранилище сломано до переоткрытия базы; `heals` — сколько переоткрытий лечат. */
const storage = { broken: false, heals: 0, reopened: 0 };
vi.mock("../src/storage/recovery", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/storage/recovery")>();
  return {
    ...original,
    reopenDatabase: async () => {
      storage.reopened++;
      if (storage.heals > 0) {
        storage.heals--;
        storage.broken = false;
      }
    },
  };
});
function SleepyScreen() {
  if (storage.broken) throw new DOMException("Attempt to iterate a cursor that doesn't exist", "UnknownError");
  return <p data-testid="screen">экран</p>;
}
const flush = async () => {
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

let root: Root | null = null,
  container: HTMLElement | null = null;
beforeEach(() => {
  resetReporting({ dsn: "https://key@o1.ingest.sentry.io/1", loader: () => Promise.reject(new Error("не в тесте")) });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  storage.reopened = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetReporting();
  vi.restoreAllMocks();
});

describe("граница ошибок и отчёты о сбоях хранилища", () => {
  it("вылеченный отказ хранилища не даёт отчёта: только крошка жизненного цикла, экран отрисован", async () => {
    storage.broken = true;
    storage.heals = 1;
    await act(async () => {
      root!.render(
        <Recovery>
          <SleepyScreen />
        </Recovery>,
      );
    });
    await flush();
    expect(storage.reopened).toBe(1);
    expect(container!.querySelector('[data-testid="screen"]')).not.toBeNull();
    expect(pendingReports()).toEqual([]);
    expect(pendingCrumbs().map((crumb) => crumb.message)).toContain("storageRecovered");
  });
  it("отказ хранилища, который не лечится, даёт один отчёт категории ui со стеком компонентов после исчерпания попыток", async () => {
    storage.broken = true;
    storage.heals = 0;
    await act(async () => {
      root!.render(
        <Recovery>
          <SleepyScreen />
        </Recovery>,
      );
    });
    await flush();
    expect(storage.reopened).toBe(3);
    expect(container!.querySelector('[data-testid="recovery-failed"]')).not.toBeNull();
    const reports = pendingReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].category).toBe("ui");
    expect(reports[0].extra?.componentStack).toContain("SleepyScreen");
  });
});
