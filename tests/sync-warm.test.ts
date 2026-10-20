import { describe, expect, it, vi } from "vitest";
import { afterFirstExchange } from "../src/sync/warm";
import type { SyncPhase } from "../src/sync/coordinator";

describe("прогрев чанка упаковки", () => {
  it("начинается в простое после первого завершённого обмена и только один раз", () => {
    let phase: SyncPhase = "idle";
    const listeners = new Set<() => void>();
    const source = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getStatus: () => ({ phase }),
    };
    const set = (next: SyncPhase) => {
      phase = next;
      listeners.forEach((listener) => listener());
    };
    const idle: (() => void)[] = [];
    const run = vi.fn();
    afterFirstExchange(source, run, (task) => idle.push(task));
    set("syncing");
    expect(idle).toHaveLength(0);
    set("synced");
    expect(run).not.toHaveBeenCalled();
    idle.forEach((task) => task());
    expect(run).toHaveBeenCalledTimes(1);
    set("syncing");
    set("error");
    expect(idle).toHaveLength(1);
    expect(listeners.size).toBe(0);
  });
});
