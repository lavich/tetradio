const BOT_NAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
export function botName(raw: unknown): string | null {
  const bot = typeof raw === "string" ? raw.replace(/^@/, "") : "";
  return BOT_NAME.test(bot) ? bot : null;
}
