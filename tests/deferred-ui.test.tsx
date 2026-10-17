// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const fake = vi.hoisted(() => {
  let phase = "idle";
  const listeners = new Set<() => void>();
  return {
    loaded: 0,
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
vi.mock("../src/sync", () => {
  fake.loaded++;
  return { sync: fake.sync };
});

import {
  afterStartup,
  afterStartupOrNeeded,
  syncNeededNow,
  useFirstInteraction,
  useSyncConflictSeen,
} from "../src/app/deferred";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
});
const mount = (element: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
};

describe("отложенные части интерфейса", () => {
  it("всплывающие сообщения подключаются с первым касанием или клавишей", () => {
    const Probe = () => <p>{useFirstInteraction() ? "on" : "off"}</p>;
    const host = mount(<Probe />);
    expect(host.textContent).toBe("off");
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(host.textContent).toBe("on");
  });

  // Фабрика мока вызывается один раз за файл: тест идёт до первого настоящего импорта чанка.
  it("слежение за конфликтом не берёт чанк синхронизации до паузы после запуска", async () => {
    vi.useFakeTimers();
    const Probe = () => <p>{useSyncConflictSeen() ? "dialog" : "none"}</p>;
    mount(<Probe />);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(fake.loaded).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(fake.loaded).toBe(1);
  });

  it("диалог конфликта монтируется с первым конфликтом и остаётся после смены фазы", async () => {
    vi.useFakeTimers();
    const Probe = () => <p>{useSyncConflictSeen() ? "dialog" : "none"}</p>;
    const host = mount(<Probe />);
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(host.textContent).toBe("none");
    act(() => fake.set("conflict"));
    expect(host.textContent).toBe("dialog");
    act(() => fake.set("syncing"));
    expect(host.textContent).toBe("dialog");
  });

  it("afterStartup отменяется до срабатывания", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const cancel = afterStartup(run);
    cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("syncNeededNow запускает отложенное сразу и ровно один раз", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    afterStartupOrNeeded(run);
    syncNeededNow();
    syncNeededNow();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledOnce();
  });

  it("отменённое отложенное не запускается и по syncNeededNow", () => {
    const run = vi.fn();
    afterStartupOrNeeded(run)();
    syncNeededNow();
    expect(run).not.toHaveBeenCalled();
  });
});
