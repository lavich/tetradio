// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { TelegramWebApp } from "../src/platform/telegram-types";

const env = vi.hoisted(() => ({ bridge: null as TelegramWebApp | null }));
vi.mock("../src/platform/platform", async (original) => ({
  ...(await original<typeof import("../src/platform/platform")>()),
  telegramBridge: () => env.bridge,
}));

import { PrivacyLink, ProjectLink } from "../src/features/progress/ExternalLink";
import { PROJECT_URL } from "../src/shared/project";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ADDRESS = new URL(`${import.meta.env.BASE_URL}privacy/`, location.origin).href;

afterEach(() => {
  env.bridge = null;
  document.body.innerHTML = "";
});

function render(link = <PrivacyLink />) {
  const host = document.body.appendChild(document.createElement("div"));
  act(() => createRoot(host).render(link));
  return host.querySelector("a")!;
}

describe("внешние ссылки «Настроек и данных»", () => {
  it("в Telegram 6.1+ открывается через openLink с полным адресом", () => {
    const openLink = vi.fn();
    const isVersionAtLeast = vi.fn(() => true);
    env.bridge = { openLink, isVersionAtLeast } as unknown as TelegramWebApp;
    const link = render();
    expect(link.textContent).toBe("Политика конфиденциальности");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => void link.dispatchEvent(click));
    expect(openLink).toHaveBeenCalledWith(ADDRESS);
    expect(isVersionAtLeast).toHaveBeenCalledWith("6.1");
    expect(click.defaultPrevented).toBe(true);
  });

  it.each([
    ["клиент ниже 6.1", { openLink: vi.fn(), isVersionAtLeast: () => false }],
    ["вне Telegram", null],
  ])("%s — обычная ссылка в новой вкладке", (_, bridge) => {
    env.bridge = bridge as unknown as TelegramWebApp | null;
    const link = render();
    expect(link.getAttribute("href")).toBe(ADDRESS);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener");
    let prevented: boolean | null = null;
    const listen = (event: Event) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", listen);
    act(() => void link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    document.removeEventListener("click", listen);
    expect(prevented).toBe(false);
    if (bridge) expect(bridge.openLink).not.toHaveBeenCalled();
  });

  it("«Проект на GitHub» в Telegram открывается через openLink", () => {
    const openLink = vi.fn();
    env.bridge = { openLink, isVersionAtLeast: () => true } as unknown as TelegramWebApp;
    const link = render(<ProjectLink />);
    expect(link.textContent).toBe("Проект на GitHub");
    act(() => void link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(openLink).toHaveBeenCalledWith(PROJECT_URL);
  });

  it("«Проект на GitHub» вне Telegram — обычная ссылка в новой вкладке", () => {
    const link = render(<ProjectLink />);
    expect(link.getAttribute("href")).toBe(PROJECT_URL);
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
