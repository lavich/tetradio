import { forget, fromForm, handle, legacyReply, type Answer, type Deps, type Update } from "./feedback";
import { MAX_BODY, readForm, readInitData, verifyInitData } from "./form";
import { databaseStore, type Database } from "./store";

export { GREETING, UNREAD } from "./texts";

export interface Env {
  WEBHOOK_SECRET?: string;
  APP_URL: string;
  BOT_TOKEN?: string;
  SUPPORT_CHAT_ID?: string;
  SENTRY_EVENT_URL?: string;
  FEEDBACK?: Database;
  APP_ORIGINS?: string;
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

const configured = (env: Env, request: typeof fetch): Deps | null =>
  env.BOT_TOKEN && env.SUPPORT_CHAT_ID && env.FEEDBACK
    ? {
        api: botApi(env.BOT_TOKEN, request),
        store: databaseStore(env.FEEDBACK),
        supportChatId: env.SUPPORT_CHAT_ID,
        sentryEventUrl: env.SENTRY_EVENT_URL ?? "",
        appUrl: env.APP_URL,
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }
    : null;

export async function respond(update: Update | null, env: Env, request: typeof fetch = fetch) {
  const deps = configured(env, request);
  return deps ? handle(update, deps) : legacyReply(update, env.APP_URL);
}

/** Без Content-Length (chunked) `request.text()` прочитал бы тело любого размера. */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const STATUS = { ok: 200, invalid: 400, stale: 401, rate: 429, failed: 502 } as const;

type Result = keyof typeof STATUS;

async function appRoute(
  request: Request,
  env: Env,
  fetcher: typeof fetch,
  act: (raw: string, deps: Deps) => Promise<Result>,
): Promise<Response> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.APP_ORIGINS ?? "").split(",").map((item) => item.trim());
  if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403 });
  const cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  const answer = (result: Result, status: number = STATUS[result]) =>
    Response.json(result === "ok" ? { ok: true } : { error: result }, { status, headers: cors });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: cors });
  const deps = configured(env, fetcher);
  if (!deps) return answer("failed", 503);
  const raw = await readLimited(request, MAX_BODY);
  return answer(raw === null ? "invalid" : await act(raw, deps));
}

const signedUser = (initData: string, env: Env, deps: Deps) =>
  verifyInitData(initData, env.BOT_TOKEN!, Math.floor(deps.now() / 1000));

export const feedbackForm = (request: Request, env: Env, fetcher: typeof fetch = fetch) =>
  appRoute(request, env, fetcher, async (raw, deps) => {
    const form = readForm(raw);
    if (!form) return "invalid";
    const user = await signedUser(form.initData, env, deps);
    return user ? fromForm({ ...form, user }, deps) : "stale";
  });

export const forgetRoute = (request: Request, env: Env, fetcher: typeof fetch = fetch) =>
  appRoute(request, env, fetcher, async (raw, deps) => {
    const initData = readInitData(raw);
    if (!initData) return "invalid";
    const user = await signedUser(initData, env, deps);
    return user ? forget(user.id, deps) : "stale";
  });

const ROUTES: Record<string, (request: Request, env: Env) => Promise<Response>> = {
  "/feedback": feedbackForm,
  "/forget": forgetRoute,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const route = ROUTES[new URL(request.url).pathname];
    if (route) return route(request, env).catch(() => new Response(null, { status: 502 }));
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
