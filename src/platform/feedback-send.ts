import { APP_BUILD, APP_VERSION } from "../reporting/reporting";
import { feedbackUrl } from "./feedback";
import { launchContext, type LaunchContext } from "./launch";
import { telegramBridge } from "./platform";
import type { TelegramWebApp } from "./telegram-types";

let answered: boolean | null = null;
/** Только для тестов. */
export const resetWriteAccess = () => {
  answered = null;
};

/**
 * Мост всегда несёт метод (скрипт с telegram.org), а старый клиент бросает исключение или молчит: тогда считаем, что
 * писать можно. Ответ запоминается до конца запуска: подписанные данные запуска после него не обновляются, и без памяти
 * Telegram спрашивал бы перед каждым сообщением.
 */
export function askWriteAccess(app: TelegramWebApp, timeout = 30_000): Promise<boolean> {
  if (answered !== null) return Promise.resolve(answered);
  if (app.initDataUnsafe.user?.allows_write_to_pm) return Promise.resolve(true);
  if (!app.requestWriteAccess || !app.isVersionAtLeast("6.9")) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), timeout);
    try {
      app.requestWriteAccess!((granted) => {
        clearTimeout(timer);
        answered = granted;
        resolve(granted);
      });
    } catch {
      clearTimeout(timer);
      resolve(true);
    }
  });
}

export type SendResult = "ok" | "stale" | "rate" | "failed";

interface BotRequest {
  app?: TelegramWebApp | null;
  launch?: LaunchContext;
  url?: string | null;
  fetcher?: typeof fetch;
  timeout?: number;
}

async function postToBot(
  body: (app: TelegramWebApp, launch: LaunchContext) => object,
  {
    app = telegramBridge(),
    launch = launchContext(),
    url = feedbackUrl(),
    fetcher = fetch,
    timeout = 15_000,
  }: BotRequest,
): Promise<SendResult> {
  if (!app?.initData || !url) return "failed";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    // text/plain — простой запрос без предварительного OPTIONS: на мобильной сети на круг меньше.
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body(app, launch)),
      signal: controller.signal,
    });
    if (response.ok) return "ok";
    if (response.status === 401) return "stale";
    if (response.status === 429) return "rate";
    return "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

export const sendFeedback = (
  message: { text: string; reportId: string | null; canReply: boolean },
  request: BotRequest = {},
) =>
  postToBot(
    (app, launch) => ({
      initData: app.initData,
      text: message.text,
      version: `${APP_VERSION} (${APP_BUILD})`,
      platform: launch.platform ?? app.platform,
      reportId: message.reportId,
      canReply: message.canReply,
    }),
    request,
  );

export const forgetMessages = ({ url = feedbackUrl(), ...request }: BotRequest = {}) =>
  postToBot((app) => ({ initData: app.initData }), { ...request, url: url && new URL("forget", url).href });
