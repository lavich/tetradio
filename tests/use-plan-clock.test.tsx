// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const planned = vi.hoisted(() => ({ calls: [] as number[], wakeAt: 0 }));
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: <T,>(query: () => Promise<T>, deps: unknown[]) => {
    const [value, setValue] = useState<T>();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => void query().then(setValue), deps);
    return value;
  },
}));
vi.mock("../src/storage/queries", () => ({ dexieSource: () => ({}), loadSettings: async () => ({}) }));
vi.mock("../src/storage/today", () => ({
  languagePlan: async () => {
    planned.calls.push(Date.now());
    return { wakeAt: new Date(planned.wakeAt) };
  },
}));

const { useLanguagePlan } = await import("../src/shared/store");

function LanguageProbe() {
  useLanguagePlan("en");
  return null;
}
let root: Root;
const start = new Date("2026-09-15T09:00:00Z").getTime();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  planned.calls.length = 0;
  planned.wakeAt = start + 20 * 60000;
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("часы плана языка", () => {
  it("не пересчитывает план каждую минуту, а просыпается к сроку wakeAt", async () => {
    await act(async () => root.render(<LanguageProbe />));
    expect(planned.calls).toHaveLength(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(19 * 60000)));
    expect(planned.calls).toHaveLength(1);
    planned.wakeAt = start + 8 * 3600000;
    await act(async () => void (await vi.advanceTimersByTimeAsync(2 * 60000)));
    expect(planned.calls).toHaveLength(2);
    expect(planned.calls[1]).toBeGreaterThanOrEqual(start + 20 * 60000);
  });
  it("пересчитывает при возврате в приложение", async () => {
    await act(async () => root.render(<LanguageProbe />));
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(planned.calls).toHaveLength(2);
  });
});
