export interface Env {
  WEBHOOK_SECRET?: string;
  APP_URL: string;
}

interface Update {
  message?: { chat?: { id?: number; type?: string }; text?: unknown } | null;
}

export const GREETING =
  "Τετράδιο — греческий с нуля до экзамена A2: уроки по программе и ежедневное повторение слов. Прогресс переносится между устройствами вашего аккаунта Telegram.";
export const UNREAD = "Сообщения боту пока не читаются. Τετράδιο открывается кнопкой ниже.";
const BUTTON = "Открыть Τετράδιο";

const isStart = (text: unknown) => typeof text === "string" && /^\/start(@\w+)?$/.test(text.split(/\s/, 1)[0]);

export function replyTo(update: Update | null, appUrl: string) {
  const message = update?.message;
  const chatId = message?.chat?.id;
  if (message?.chat?.type !== "private" || typeof chatId !== "number") return null;
  return {
    method: "sendMessage",
    chat_id: chatId,
    text: isStart(message.text) ? GREETING : UNREAD,
    reply_markup: { inline_keyboard: [[{ text: BUTTON, web_app: { url: appUrl } }]] },
  };
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
    const reply = replyTo(update, env.APP_URL);
    return reply ? Response.json(reply) : new Response(null);
  },
};
