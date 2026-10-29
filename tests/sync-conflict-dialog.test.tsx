// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SyncStatus } from "../src/sync/coordinator";
import { dateTime } from "../src/shared/format";
import { branchLine } from "../src/sync/status-text";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const description = {
  cards: 3,
  answers: 5,
  lastDay: "2026-10-14",
  lastAnswerAt: "2026-10-14T18:40:00Z",
  lessons: 1,
  courseLessons: 0,
  blocks: 0,
};
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
    failDefer: false,
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
      store.set({
        reason: "Версии изменились — выберите ещё раз.",
        conflict: { kind: "diverged", branches: [branch("local", true), branch("ios-3", false)], deferred: false },
      });
      return store.status;
    },
    dismissChoice: () => store.set({ reason: null }),
    deferChoice: async () => {
      if (store.failDefer) throw new Error("IndexedDB недоступна");
      store.set({ conflict: { ...store.status.conflict!, deferred: true } });
    },
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
  it("выбор исчезнувшей версии показывает просьбу выбрать ещё раз и возвращает фокус к выбору", async () => {
    store.status = {
      phase: "conflict",
      lastConfirmedAt: null,
      dirty: true,
      error: null,
      conflict: { kind: "diverged", branches: [branch("local", true), branch("ios-2", false)], deferred: false },
      keys: null,
      reason: null,
    };
    const { SyncConflictDialog } = await import("../src/app/TelegramNotices");
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<SyncConflictDialog />));
    const dialog = () => document.querySelector("[role=alertdialog]")!;
    expect(dialog().querySelector("[role=status]")?.textContent).toBe("");
    const choices = () =>
      [...dialog().querySelectorAll("button")].filter((button) => button.textContent === "Продолжить с этой версии");
    await act(async () => choices()[1].click());
    expect(dialog().querySelector("[role=status]")?.textContent).toBe("Версии изменились — выберите ещё раз.");
    expect(document.activeElement).toBe(choices()[0]);
    const later = [...dialog().querySelectorAll("button")].find((button) => button.textContent === "Решить позже")!;
    act(() => later.click());
    expect(store.status.reason).toBeNull();
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
  });
  it("у версий — время последнего ответа, у облачной — время отправки, без текущего времени у своей", async () => {
    store.status = {
      phase: "conflict",
      lastConfirmedAt: null,
      dirty: true,
      error: null,
      conflict: { kind: "diverged", branches: [branch("local", true), branch("ios-2", false)], deferred: false },
      keys: null,
      reason: null,
    };
    const { SyncConflictDialog } = await import("../src/app/TelegramNotices");
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<SyncConflictDialog />));
    const [local, remote] = [...document.querySelectorAll("[role=listitem] p.text-sm")].map((line) => line.textContent);
    // Дата и время — по часовому поясу устройства, как и в окне.
    const answer = dateTime("2026-10-14T18:40:00Z");
    const sent = dateTime("2026-10-15T08:00:00Z");
    expect(local).toBe(`Последний ответ ${answer} · 3 карточки в обучении · 5 ответов`);
    expect(remote).toBe(`Отправлено ${sent} · последний ответ ${answer} · 3 карточки в обучении · 5 ответов`);
  });
  it("отложенный конфликт окна не показывает", async () => {
    store.status = {
      phase: "conflict",
      lastConfirmedAt: null,
      dirty: true,
      error: null,
      conflict: { kind: "diverged", branches: [branch("local", true), branch("ios-2", false)], deferred: true },
      keys: null,
      reason: null,
    };
    const { SyncConflictDialog } = await import("../src/app/TelegramNotices");
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<SyncConflictDialog />));
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
  });
  it("«Решить позже» прячет окно и при сбое записи на устройстве", async () => {
    store.failDefer = true;
    store.status = {
      phase: "conflict",
      lastConfirmedAt: null,
      dirty: true,
      error: null,
      conflict: { kind: "diverged", branches: [branch("local", true), branch("ios-2", false)], deferred: false },
      keys: null,
      reason: null,
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { SyncConflictDialog } = await import("../src/app/TelegramNotices");
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<SyncConflictDialog />));
    const later = [...document.querySelectorAll("button")].find((button) => button.textContent === "Решить позже")!;
    await act(async () => later.click());
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    expect(warn).toHaveBeenCalled();
    store.failDefer = false;
    warn.mockRestore();
  });
});

describe("строка версии", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  it("без времени ответов — последнее занятие по дню, с заглавной", () => {
    expect(branchLine({ local: true, createdAt: "", description: { ...description, lastAnswerAt: null } }, now)).toBe(
      "Последнее занятие 14 октября · 3 карточки в обучении · 5 ответов",
    );
  });
  it("без ответов и дней — только объём", () => {
    expect(
      branchLine(
        { local: true, createdAt: "", description: { ...description, lastAnswerAt: null, lastDay: null } },
        now,
      ),
    ).toBe("3 карточки в обучении · 5 ответов");
  });
  it("прошлогодняя версия — с годом", () => {
    expect(
      branchLine(
        { local: false, createdAt: "2025-12-30T10:00:00Z", description: { ...description, lastAnswerAt: null } },
        now,
      ),
    ).toMatch(/^Отправлено 30 декабря 2025 в /);
  });
});
