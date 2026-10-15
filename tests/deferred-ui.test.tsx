// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const fake = vi.hoisted(() => {
  let phase = "idle";
  const listeners = new Set<() => void>();
  return {
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

import { useFirstInteraction, useSyncConflictSeen } from "../src/app/deferred";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
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
const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

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

  it("диалог конфликта монтируется с первым конфликтом и остаётся после смены фазы", async () => {
    const Probe = () => <p>{useSyncConflictSeen() ? "dialog" : "none"}</p>;
    const host = mount(<Probe />);
    await flush();
    expect(host.textContent).toBe("none");
    act(() => fake.set("conflict"));
    expect(host.textContent).toBe("dialog");
    act(() => fake.set("syncing"));
    expect(host.textContent).toBe("dialog");
  });
});
