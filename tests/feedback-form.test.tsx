// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TelegramWebApp } from "../src/platform/telegram-types";

const env = vi.hoisted(() => {
  vi.stubEnv("VITE_TELEGRAM_BOT", "TetradioBot");
  return { bridge: null as TelegramWebApp | null };
});
vi.mock("../src/platform/platform", async (original) => ({
  ...(await original<typeof import("../src/platform/platform")>()),
  telegramBridge: () => env.bridge,
}));

import { FeedbackButton } from "../src/features/feedback/FeedbackButton";
import { CrashScreen } from "../src/app/CrashScreen";
import { resetLaunchContext } from "../src/platform/launch";
import { resetWriteAccess } from "../src/platform/feedback-send";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const URL_ = "https://bot.example.workers.dev/feedback";
const REPORT = "0123456789abcdef0123456789abcdef";

let root: Root;
let host: HTMLElement;
let requests: { body: Record<string, unknown> }[];
let respond: () => Promise<Response>;

const bridge = (fields: Partial<TelegramWebApp> = {}) =>
  ({
    initData: "user=%7B%22id%22%3A7%7D&hash=abc",
    initDataUnsafe: { user: { id: 7, first_name: "A" } },
    platform: "ios",
    isVersionAtLeast: () => true,
    requestWriteAccess: (callback?: (granted: boolean) => void) => callback?.(true),
    ...fields,
  }) as unknown as TelegramWebApp;

beforeEach(() => {
  vi.stubEnv("VITE_FEEDBACK_URL", URL_);
  window.location.hash = `#tgWebAppPlatform=ios&tgWebAppData=${encodeURIComponent(`user=${JSON.stringify({ id: 7 })}`)}`;
  resetLaunchContext();
  env.bridge = bridge();
  requests = [];
  respond = async () => Response.json({ ok: true });
  vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
    requests.push({ body: JSON.parse(init.body as string) as Record<string, unknown> });
    return respond();
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
  resetLaunchContext();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_TELEGRAM_BOT", "TetradioBot");
  resetWriteAccess();
  vi.restoreAllMocks();
});

async function settle(until: () => boolean = () => false) {
  for (let i = 0; i < 200 && !until(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}
const formShown = () => host.querySelector("textarea") !== null;
const button = (name: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === name);
const field = () => host.querySelector("textarea")!;
async function type(text: string) {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!;
    descriptor.set!.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function open(node = <FeedbackButton reportId={null} />) {
  act(() => root.render(node));
  await act(async () => button("Написать автору")!.click());
  await settle(formShown);
}
const submit = async () => {
  await act(async () => button("Отправить")!.click());
  await settle(() => !button("Отправка…"));
};

describe("форма «Написать автору»", () => {
  it("раскрывается на месте, поле в фокусе", async () => {
    await open();
    expect(host.querySelector('[data-testid="feedback-form"]')).not.toBeNull();
    expect(document.activeElement).toBe(field());
    expect(host.textContent).toContain("Вместе с сообщением уйдут версия приложения и платформа.");
    expect(button("Отправить")!.disabled).toBe(true);
  });

  it("сверх 3000 символов — счётчик и «Отправить» недоступна", async () => {
    await open();
    await type("я".repeat(3002));
    expect(host.textContent).toContain("Длиннее на 2 — предел 3000 символов.");
    expect(button("Отправить")!.disabled).toBe(true);
  });

  it("отправка: тело запроса, «Отправлено», черновик стёрт", async () => {
    await open();
    await type("  Опечатка в уроке 3 ");
    expect(localStorage.getItem("tetradio:feedback-draft")).toBe("  Опечатка в уроке 3 ");
    await submit();
    expect(requests[0].body).toMatchObject({
      text: "Опечатка в уроке 3",
      platform: "ios",
      reportId: null,
      canReply: true,
    });
    expect(host.textContent).toContain("Отправлено. Ответ придёт в чат с ботом.");
    expect(localStorage.getItem("tetradio:feedback-draft")).toBeNull();
    await act(async () => button("Написать ещё")!.click());
    expect(field().value).toBe("");
  });

  it("отказ в разрешении — отправлено, но автор не сможет ответить", async () => {
    env.bridge = bridge({ requestWriteAccess: (callback?: (granted: boolean) => void) => callback?.(false) });
    await open();
    await type("Вопрос");
    await submit();
    expect(requests[0].body.canReply).toBe(false);
    expect(host.textContent).toContain("Отправлено. Автор не сможет ответить, пока боту нельзя писать вам.");
  });

  it("пока Telegram спрашивает разрешение — «Отправить» недоступна", async () => {
    let answer: (granted: boolean) => void = () => undefined;
    env.bridge = bridge({
      requestWriteAccess: (callback?: (granted: boolean) => void) => {
        answer = callback!;
      },
    });
    await open();
    await type("Вопрос");
    await act(async () => button("Отправить")!.click());
    expect(button("Отправка…")!.disabled).toBe(true);
    expect(requests).toEqual([]);
    await act(async () => answer(true));
    await settle();
    expect(requests).toHaveLength(1);
  });

  it.each([
    [401, "Закройте приложение и откройте снова — текст сохранится."],
    [429, "Подождите несколько секунд и отправьте снова."],
    [502, "Не удалось отправить. Проверьте сеть и попробуйте ещё раз."],
  ])("ответ %i — свой текст, черновик сохранён и возвращается после перезапуска", async (status, message) => {
    respond = async () => Response.json({}, { status });
    await open();
    await type("Важное");
    await submit();
    expect(host.textContent).toContain(message);
    expect(field().value).toBe("Важное");
    act(() => root.unmount());
    root = createRoot(host);
    await open();
    expect(field().value).toBe("Важное");
  });

  it("без адреса формы — переход в чат, как раньше", async () => {
    vi.stubEnv("VITE_FEEDBACK_URL", "");
    const opened: string[] = [];
    env.bridge = bridge({ openTelegramLink: (url: string) => opened.push(url) } as Partial<TelegramWebApp>);
    await open();
    expect(host.querySelector('[data-testid="feedback-form"]')).toBeNull();
    expect(opened).toEqual(["https://t.me/TetradioBot?start=feedback"]);
  });
});

describe("форма на экране сбоя", () => {
  const screen = (reportId: string | null) => (
    <CrashScreen
      title="Сбой"
      description="Что-то сломалось"
      error={new Error("x")}
      reportId={reportId}
      testId="crash"
    />
  );

  it("мост пришёл после показа экрана, отчёт — тоже: форма и отчёт в теле", async () => {
    env.bridge = null;
    act(() => root.render(screen(null)));
    env.bridge = bridge();
    act(() => root.render(screen(REPORT)));
    await act(async () => button("Написать автору")!.click());
    await settle(formShown);
    await type("Упало на уроке");
    await submit();
    expect(requests[0].body).toMatchObject({ reportId: REPORT, text: "Упало на уроке" });
  });
});
