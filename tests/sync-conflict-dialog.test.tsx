// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SyncStatus } from "../src/sync/coordinator";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const description = { cards: 3, answers: 5, lastDay: "2026-10-14", lessons: 1, courseLessons: 0, blocks: 0 };
const branch = (id: string, local: boolean) => ({
  id,
  local,
  label: local ? "Это устройство" : "ios",
  device: local ? "tablet" : "phone",
  createdAt: "2026-10-15T08:00:00Z",
  description,
  snapshot: {} as never,
  meta: null,
});
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    status: null as unknown as SyncStatus,
    set: (patch: Partial<SyncStatus>) => {
      store.status = { ...store.status, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
vi.mock("../src/sync", () => ({
  sync: {
    resolve: async () => {
      store.set({ reason: "Версии изменились — выберите ещё раз." });
      return store.status;
    },
    dismissChoice: () => store.set({ reason: null }),
  },
  useSyncStatus: () => useSyncExternalStore(store.subscribe, () => store.status),
}));

let root: Root | null = null,
  container: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("окно выбора версии", () => {
  it("выбор исчезнувшей версии показывает просьбу выбрать ещё раз", async () => {
    store.status = {
      phase: "conflict",
      lastConfirmedAt: null,
      dirty: true,
      error: null,
      conflict: { kind: "diverged", branches: [branch("local", true), branch("ios-2", false)] },
      keys: null,
      reason: null,
    };
    const { SyncConflictDialog } = await import("../src/app/TelegramNotices");
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<SyncConflictDialog />));
    const dialog = () => document.querySelector("[role=alertdialog]")!;
    expect(dialog().querySelector("[role=status]")).toBeNull();
    const buttons = [...dialog().querySelectorAll("button")].filter(
      (button) => button.textContent === "Продолжить с этой версии",
    );
    await act(async () => buttons[1].click());
    expect(dialog().querySelector("[role=status]")?.textContent).toBe("Версии изменились — выберите ещё раз.");
    const later = [...dialog().querySelectorAll("button")].find((button) => button.textContent === "Решить позже")!;
    act(() => later.click());
    expect(store.status.reason).toBeNull();
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
  });
});
