// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { feedbackBot, feedbackLink, openFeedback } from "../src/platform/feedback";
import type { LaunchContext } from "../src/platform/launch";
import type { TelegramWebApp } from "../src/platform/telegram-types";

const REPORT = "0123456789abcdef0123456789abcdef";
const telegram = { kind: "telegram", bot: "TetradioBot" } as LaunchContext;
const web = { kind: "web", bot: "evil_bot" } as LaunchContext;

afterEach(() => vi.restoreAllMocks());

describe("ссылка «Написать автору»", () => {
  it("без отчёта и с идентификатором не того формата — feedback", () => {
    expect(feedbackLink("TetradioBot")).toBe("https://t.me/TetradioBot?start=feedback");
    expect(feedbackLink("TetradioBot", null)).toBe("https://t.me/TetradioBot?start=feedback");
    expect(feedbackLink("TetradioBot", "abc")).toBe("https://t.me/TetradioBot?start=feedback");
    expect(feedbackLink("TetradioBot", REPORT.toUpperCase())).toBe("https://t.me/TetradioBot?start=feedback");
  });

  it("с отчётом — fb_ и идентификатор", () => {
    expect(feedbackLink("TetradioBot", REPORT)).toBe(`https://t.me/TetradioBot?start=fb_${REPORT}`);
  });

  it("в Telegram — бот запуска, вне Telegram — бот сборки, а не ?bot= из адреса", () => {
    expect(feedbackBot({ ...telegram, bot: "tetradio_dev" }, "TetradioBot")).toBe("tetradio_dev");
    expect(feedbackBot(web, "TetradioBot")).toBe("TetradioBot");
    expect(feedbackBot(web, null)).toBeNull();
  });

  it("при доступном мосте открывается через openTelegramLink", () => {
    const opened: string[] = [];
    const app = { openTelegramLink: (url: string) => opened.push(url) } as unknown as TelegramWebApp;
    const popup = vi.spyOn(window, "open").mockImplementation(() => null);
    openFeedback(REPORT, app, telegram);
    expect(opened).toEqual([`https://t.me/TetradioBot?start=fb_${REPORT}`]);
    expect(popup).not.toHaveBeenCalled();
  });

  it("без моста — новая вкладка", () => {
    const popup = vi.spyOn(window, "open").mockImplementation(() => null);
    openFeedback(null, null, telegram);
    expect(popup).toHaveBeenCalledWith("https://t.me/TetradioBot?start=feedback", "_blank", "noopener");
  });

  it("вне Telegram без бота сборки ничего не открывается", () => {
    const popup = vi.spyOn(window, "open").mockImplementation(() => null);
    openFeedback(null, null, web, null);
    expect(popup).not.toHaveBeenCalled();
  });
});
