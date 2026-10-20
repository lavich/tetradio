// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const fake = vi.hoisted(() => {
  let phase = "idle";
  const listeners = new Set<() => void>();
  return {
    noticesLoaded: 0,
    set(next: string) {
      phase = next;
      for (const listener of listeners) listener();
    },
    sync: {
      getStatus: () => ({ phase }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});
vi.mock("../src/sync", () => ({ sync: fake.sync }));
vi.mock("../src/features/today/TodayScreen", () => ({ TodayScreen: () => <p>today</p> }));
vi.mock("../src/app/Nav", () => ({ Nav: () => null }));
vi.mock("../src/app/navigation", () => ({ useGoBack: () => () => {}, useStartRoute: () => {} }));
vi.mock("../src/app/scroll", () => ({ useScrollMemory: () => {} }));
vi.mock("../src/platform/platform", () => ({ useEnvironment: () => {}, useBackHandler: () => {} }));
vi.mock("../src/components/ui/sonner", () => ({ Toaster: () => <p data-testid="toaster" /> }));
vi.mock("sonner", () => ({ toast: () => {} }));
vi.mock("../src/app/TelegramNotices", () => {
  fake.noticesLoaded++;
  return { SyncConflictDialog: () => <p data-testid="conflict" /> };
});

import { App } from "../src/app/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  fake.set("idle");
});
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 50)));
const render = () =>
  act(() =>
    root!.render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    ),
  );
const has = (id: string) => host.querySelector(`[data-testid="${id}"]`) !== null;

describe("App: необязательные части после первого экрана", () => {
  it("всплывающие сообщения монтируются с первым касанием", async () => {
    render();
    await settle();
    expect(has("toaster")).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await settle();
    expect(has("toaster")).toBe(true);
  });

  it("всплывающие сообщения монтируются с уведомлением об обновлении", async () => {
    render();
    await settle();
    act(() => {
      window.dispatchEvent(new CustomEvent("tetradio:update"));
    });
    await settle();
    expect(has("toaster")).toBe(true);
  });

  it("чанк диалога конфликта берётся после запуска, диалог показывается с конфликтом", async () => {
    render();
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 2300)));
    expect(fake.noticesLoaded).toBe(1);
    expect(has("conflict")).toBe(false);
    act(() => fake.set("conflict"));
    await settle();
    expect(has("conflict")).toBe(true);
  });
});
