import { afterEach, describe, expect, it, vi } from "vitest";
import { localDay, zonedStart } from "../src/domain/time";

afterEach(() => vi.restoreAllMocks());

describe("день и начало дня в часовом поясе", () => {
  it("день и начало дня считаются в своей зоне, в том числе при переходе на летнее время", () => {
    const instant = new Date("2026-03-29T22:30:00Z");
    expect(localDay(instant, "Asia/Nicosia")).toBe("2026-03-30");
    expect(localDay(instant, "UTC")).toBe("2026-03-29");
    expect(localDay(instant, "America/New_York")).toBe("2026-03-29");
    expect(localDay(instant, "Asia/Nicosia")).toBe("2026-03-30");
    expect(zonedStart("2026-03-29", "Asia/Nicosia", 4).toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(zonedStart("2026-03-30", "Asia/Nicosia", 4).toISOString()).toBe("2026-03-30T01:00:00.000Z");
    expect(zonedStart("2026-03-28", "Asia/Nicosia", 4).toISOString()).toBe("2026-03-28T02:00:00.000Z");
    expect(zonedStart("2026-03-29", "UTC").toISOString()).toBe("2026-03-29T00:00:00.000Z");
  });
  it("форматтер зоны создаётся один раз, а не на каждый вызов", () => {
    localDay(new Date(), "Europe/Lisbon");
    zonedStart("2026-10-13", "Europe/Lisbon");
    const created = vi.spyOn(Intl, "DateTimeFormat");
    for (let index = 0; index < 100; index++) {
      localDay(new Date(Date.UTC(2026, 0, 1 + index)), "Europe/Lisbon");
      zonedStart("2026-10-13", "Europe/Lisbon", 4);
    }
    expect(created).not.toHaveBeenCalled();
  });
});
