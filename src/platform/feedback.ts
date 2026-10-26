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
