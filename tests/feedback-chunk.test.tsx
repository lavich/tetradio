// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { TelegramWebApp } from "../src/platform/telegram-types";

const env = vi.hoisted(() => {
  vi.stubEnv("VITE_TELEGRAM_BOT", "TetradioBot");
  vi.stubEnv("VITE_FEEDBACK_URL", "https://bot.example.workers.dev/feedback");
  return { opened: [] as string[] };
});
vi.mock("../src/platform/platform", async (original) => ({
  ...(await original<typeof import("../src/platform/platform")>()),
  telegramBridge: () =>
    ({
      initData: "user=x&hash=y",
      openTelegramLink: (url: string) => env.opened.push(url),
    }) as unknown as TelegramWebApp,
}));
vi.mock("../src/features/feedback/FeedbackForm", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

import { FeedbackButton } from "../src/features/feedback/FeedbackButton";
import { resetLaunchContext } from "../src/platform/launch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError = () => ({ failed: true });
  render = () => (this.state.failed ? "boundary" : this.props.children);
}

afterEach(() => {
  window.location.hash = "";
  sessionStorage.clear();
  resetLaunchContext();
  vi.unstubAllEnvs();
});

describe("код формы не загрузился", () => {
  it("вместо формы — переход в чат, экран не падает", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.location.hash = `#tgWebAppPlatform=ios&tgWebAppData=${encodeURIComponent(`user=${JSON.stringify({ id: 7 })}`)}`;
    resetLaunchContext();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() =>
      root.render(
        <Boundary>
          <FeedbackButton reportId={null} />
        </Boundary>,
      ),
    );
    await act(async () => host.querySelector("button")!.click());
    for (let i = 0; i < 50; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(host.textContent).not.toBe("boundary");
    const fallback = [...host.querySelectorAll("button")].find((button) => button.textContent === "Написать автору");
    expect(fallback).toBeDefined();
    await act(async () => fallback!.click());
    expect(env.opened).toEqual(["https://t.me/TetradioBot?start=feedback"]);
    act(() => root.unmount());
    host.remove();
  });
});
