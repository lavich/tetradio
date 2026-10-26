import { CONFIGURED_BOT, launchContext, type LaunchContext } from "./launch";
import { telegramBridge } from "./platform";
import type { TelegramWebApp } from "./telegram-types";

const REPORT_ID = /^[0-9a-f]{32}$/;
export const feedbackLink = (bot: string, reportId: string | null = null) =>
  `https://t.me/${bot}?start=${reportId && REPORT_ID.test(reportId) ? `fb_${reportId}` : "feedback"}`;

/** Вне Telegram `?bot=` из адреса не учитывается: чужая ссылка увела бы сообщение и идентификатор отчёта в другого бота. */
export const feedbackBot = (launch: LaunchContext = launchContext(), configured: string | null = CONFIGURED_BOT) =>
  launch.kind === "telegram" ? launch.bot : configured;

export function openFeedback(
  reportId: string | null = null,
  app: TelegramWebApp | null = telegramBridge(),
  launch: LaunchContext = launchContext(),
  configured: string | null = CONFIGURED_BOT,
) {
  const bot = feedbackBot(launch, configured);
  if (!bot) return;
  const url = feedbackLink(bot, reportId);
  if (app?.openTelegramLink) app.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export const feedbackUrl = (): string | null => import.meta.env.VITE_FEEDBACK_URL || null;

/** Бот разработки подписывает `initData` своим токеном — обработчик формы его не примет. */
export const formAvailable = (
  launch: LaunchContext = launchContext(),
  app: TelegramWebApp | null = telegramBridge(),
  configured: string | null = CONFIGURED_BOT,
  url: string | null = feedbackUrl(),
) => Boolean(url && launch.kind === "telegram" && launch.bot === configured && app?.initData);
