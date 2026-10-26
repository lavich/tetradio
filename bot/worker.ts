import { handle, legacyReply, type Answer, type Update } from "./feedback";
import { databaseStore, type Database } from "./store";

export { GREETING, UNREAD } from "./texts";

export interface Env {
  WEBHOOK_SECRET?: string;
  APP_URL: string;
  BOT_TOKEN?: string;
  SUPPORT_CHAT_ID?: string;
  SENTRY_EVENT_URL?: string;
  FEEDBACK?: Database;
}

function sameSecret(given: string | null, expected: string | undefined) {
  if (!expected || given === null) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

const botApi = (token: string, request: typeof fetch) => async (method: string, body: object) =>
  (await (
    await request(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  ).json()) as Answer;

export async function respond(update: Update | null, env: Env, request: typeof fetch = fetch) {
  if (!env.BOT_TOKEN || !env.SUPPORT_CHAT_ID || !env.FEEDBACK) return legacyReply(update, env.APP_URL);
  return handle(update, {
    api: botApi(env.BOT_TOKEN, request),
    store: databaseStore(env.FEEDBACK),
    supportChatId: env.SUPPORT_CHAT_ID,
    sentryEventUrl: env.SENTRY_EVENT_URL ?? "",
    appUrl: env.APP_URL,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (!sameSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.WEBHOOK_SECRET))
      return new Response(null, { status: 401 });
    let update: Update | null;
    try {
      update = (await request.json()) as Update;
    } catch {
      return new Response(null);
    }
    // Не-2xx Telegram доставляет повторно — сообщение пришло бы в тему дважды.
    const reply = await respond(update, env).catch(() => null);
    return reply ? Response.json(reply) : new Response(null);
  },
};
