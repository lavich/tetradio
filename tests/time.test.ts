import { afterEach, describe, expect, it, vi } from "vitest";
import { localDay, studyDay, zonedStart } from "../src/domain/time";
import { eventDay } from "../src/shared/format";

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

describe("учебный день с 04:00", () => {
  const day = (iso: string, timezone = "Asia/Nicosia") => studyDay(new Date(iso), timezone);
  it("до 04:00 продолжается вчерашний день", () => {
    expect(day("2026-10-16T00:59:00Z")).toBe("2026-10-15");
    expect(day("2026-10-16T01:00:00Z")).toBe("2026-10-16");
    expect(day("2026-10-16T00:00:00Z", "UTC")).toBe("2026-10-15");
    expect(day("2026-10-15T21:00:00Z", "Europe/Athens")).toBe("2026-10-15");
  });
  it("переход на зимнее время: второй час 03:00–04:00 ещё вчерашний, день длится 25 часов", () => {
    expect(day("2026-10-25T00:30:00Z")).toBe("2026-10-24");
    expect(day("2026-10-25T01:30:00Z")).toBe("2026-10-24");
    expect(day("2026-10-25T02:00:00Z")).toBe("2026-10-25");
    expect(
      zonedStart("2026-10-25", "Asia/Nicosia", 4).getTime() - zonedStart("2026-10-24", "Asia/Nicosia", 4).getTime(),
    ).toBe(25 * 3600000);
  });
  it("переход на летнее время: новый день с 04:00 летнего времени, прошлый длится 23 часа", () => {
    expect(day("2026-03-29T00:59:00Z")).toBe("2026-03-28");
    expect(day("2026-03-29T01:00:00Z")).toBe("2026-03-29");
    expect(
      zonedStart("2026-03-29", "Asia/Nicosia", 4).getTime() - zonedStart("2026-03-28", "Asia/Nicosia", 4).getTime(),
    ).toBe(23 * 3600000);
  });
  it("в поясе с переводом часов в полночь граница 04:00 существует", () => {
    expect(zonedStart("2026-03-08", "America/Havana", 4).toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(day("2026-03-08T07:59:00Z", "America/Havana")).toBe("2026-03-07");
    expect(day("2026-03-08T08:00:00Z", "America/Havana")).toBe("2026-03-08");
  });
});

describe("дата факта", () => {
  it("урок или текст, отмеченные в 00:30, подписаны вчерашним днём, в 04:30 — своим", () => {
    expect(eventDay("2026-10-15T21:30:00Z", "Asia/Nicosia")).toBe("15 октября");
    expect(eventDay("2026-10-16T01:30:00Z", "Asia/Nicosia")).toBe("16 октября");
  });
});
