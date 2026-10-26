import { afterEach, describe, expect, it, vi } from "vitest";
import { formAvailable } from "../src/platform/feedback";
import { askWriteAccess, resetWriteAccess, sendFeedback } from "../src/platform/feedback-send";
import type { LaunchContext } from "../src/platform/launch";
import type { TelegramWebApp } from "../src/platform/telegram-types";

const URL_ = "https://bot.example.workers.dev/feedback";
const REPORT = "0123456789abcdef0123456789abcdef";
const telegram = { kind: "telegram", bot: "TetradioBot", platform: "ios" } as LaunchContext;

const bridge = (fields: Partial<TelegramWebApp> = {}) =>
  ({
    initData: "user=%7B%7D&hash=abc",
    initDataUnsafe: { user: { id: 7, first_name: "A" } },
    platform: "ios",
    isVersionAtLeast: () => true,
    ...fields,
  }) as unknown as TelegramWebApp;

afterEach(() => {
  vi.useRealTimers();
  resetWriteAccess();
});

describe("доступность формы", () => {
  it("в Telegram основного бота с адресом и initData — есть", () => {
    expect(formAvailable(telegram, bridge(), "TetradioBot", URL_)).toBe(true);
  });

  it.each([
    ["без адреса", telegram, bridge(), "TetradioBot", null],
    ["вне Telegram", { ...telegram, kind: "web" } as LaunchContext, bridge(), "TetradioBot", URL_],
    ["бот разработки", { ...telegram, bot: "tetradio_dev" } as LaunchContext, bridge(), "TetradioBot", URL_],
    ["без моста", telegram, null, "TetradioBot", URL_],
    ["без initData", telegram, bridge({ initData: "" }), "TetradioBot", URL_],
  ])("%s — нет", (_, launch, app, configured, url) => {
    expect(formAvailable(launch, app, configured, url)).toBe(false);
  });
});

describe("разрешение боту писать", () => {
  it("уже разрешено в подписанных данных — без вопроса", async () => {
    const requestWriteAccess = vi.fn();
    const app = bridge({
      requestWriteAccess,
      initDataUnsafe: { user: { id: 7, first_name: "A", allows_write_to_pm: true } },
    });
    expect(await askWriteAccess(app)).toBe(true);
    expect(requestWriteAccess).not.toHaveBeenCalled();
  });

  it.each([true, false])("ответ Telegram %s", async (granted) => {
    const app = bridge({ requestWriteAccess: (callback?: (granted: boolean) => void) => callback?.(granted) });
    expect(await askWriteAccess(app)).toBe(granted);
  });

  it("ответ запоминается до конца запуска — второй раз не спрашивает", async () => {
    const requestWriteAccess = vi.fn((callback?: (granted: boolean) => void) => callback?.(false));
    const app = bridge({ requestWriteAccess });
    expect(await askWriteAccess(app)).toBe(false);
    expect(await askWriteAccess(app)).toBe(false);
    expect(requestWriteAccess).toHaveBeenCalledTimes(1);
  });

  it("клиент ниже 6.9 — считаем, что можно", async () => {
    const requestWriteAccess = vi.fn();
    expect(await askWriteAccess(bridge({ requestWriteAccess, isVersionAtLeast: () => false }))).toBe(true);
    expect(requestWriteAccess).not.toHaveBeenCalled();
  });

  it("исключение — считаем, что можно", async () => {
    const app = bridge({
      requestWriteAccess: () => {
        throw new Error("WebAppWriteAccessRequested");
      },
    });
    expect(await askWriteAccess(app)).toBe(true);
  });

  it("клиент не ответил за 30 секунд — считаем, что можно", async () => {
    vi.useFakeTimers();
    const pending = askWriteAccess(bridge({ requestWriteAccess: () => undefined }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toBe(true);
  });
});

describe("отправка", () => {
  const send = (response: () => Promise<Response>) => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return response();
    }) as unknown as typeof fetch;
    return { requests, fetcher };
  };

  it("тело: initData, текст, версия, платформа, отчёт, разрешение; text/plain", async () => {
    const { requests, fetcher } = send(async () => Response.json({ ok: true }));
    const result = await sendFeedback(
      { text: "Опечатка", reportId: REPORT, canReply: false },
      { app: bridge(), launch: telegram, url: URL_, fetcher },
    );
    expect(result).toBe("ok");
    expect(requests[0].url).toBe(URL_);
    expect(new Headers(requests[0].init.headers).get("Content-Type")).toBe("text/plain");
    const body = JSON.parse(requests[0].init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      initData: "user=%7B%7D&hash=abc",
      text: "Опечатка",
      platform: "ios",
      reportId: REPORT,
      canReply: false,
    });
    expect(String(body.version)).toMatch(/^[\w.+() -]{1,32}$/);
  });

  it.each([
    [401, "stale"],
    [429, "rate"],
    [400, "failed"],
    [502, "failed"],
    [503, "failed"],
  ])("ответ %i — %s", async (status, expected) => {
    const { fetcher } = send(async () => Response.json({}, { status }));
    expect(
      await sendFeedback(
        { text: "x", reportId: null, canReply: true },
        { app: bridge(), launch: telegram, url: URL_, fetcher },
      ),
    ).toBe(expected);
  });

  it("сбой сети — failed", async () => {
    const { fetcher } = send(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(
      await sendFeedback(
        { text: "x", reportId: null, canReply: true },
        { app: bridge(), launch: telegram, url: URL_, fetcher },
      ),
    ).toBe("failed");
  });

  it("ответа нет 15 секунд — failed", async () => {
    vi.useFakeTimers();
    const fetcher = ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      )) as unknown as typeof fetch;
    const pending = sendFeedback(
      { text: "x", reportId: null, canReply: true },
      { app: bridge(), launch: telegram, url: URL_, fetcher },
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toBe("failed");
  });
});
