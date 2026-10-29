import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import worker, { GREETING, UNREAD, feedbackForm, forgetRoute, respond } from "../bot/worker";
import { FAILED, INVITE } from "../bot/texts";
import type { Update } from "../bot/feedback";
import { sqlite } from "./helpers/sqlite-d1";

const SECRET = "s3cret_value-1";
const APP_URL = "https://tetradio.app/app/";
const env = { WEBHOOK_SECRET: SECRET, APP_URL };

const post = (body: unknown, headers: Record<string, string> = { "X-Telegram-Bot-Api-Secret-Token": SECRET }) =>
  new Request("https://bot.example.workers.dev/", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const message = (fields: Record<string, unknown>, chat: Record<string, unknown> = { id: 42, type: "private" }) => ({
  update_id: 1,
  message: { message_id: 7, date: 0, chat, ...fields },
});

async function answer(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  const body = (await response.json()) as {
    method: string;
    chat_id: number;
    text: string;
    reply_markup: { inline_keyboard: { text: string; web_app: { url: string } }[][] };
  };
  expect(body.method).toBe("sendMessage");
  expect(body.chat_id).toBe(42);
  expect(body.reply_markup.inline_keyboard[0][0]).toEqual({ text: "Открыть Τετράδιο", web_app: { url: APP_URL } });
  return body.text;
}

async function silent(response: Response, status = 200) {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe("");
}

describe("ответ бота в личном чате", () => {
  it.each(["/start", "/start@TetradioBot", "/start w_x", "/start\nпривет"])(
    "%s получает приветствие с кнопкой",
    async (text) => {
      expect(await answer(await worker.fetch(post(message({ text })), env))).toBe(GREETING);
    },
  );

  it("текст получает короткий ответ с кнопкой", async () => {
    expect(await answer(await worker.fetch(post(message({ text: "привет" })), env))).toBe(UNREAD);
  });

  it("фото без текста получает короткий ответ с кнопкой", async () => {
    const photo = message({ photo: [{ file_id: "x", file_unique_id: "y", width: 1, height: 1 }] });
    expect(await answer(await worker.fetch(post(photo), env))).toBe(UNREAD);
  });

  it("команда, похожая на start, — не приветствие", async () => {
    expect(await answer(await worker.fetch(post(message({ text: "/started" })), env))).toBe(UNREAD);
  });

  it("подпись /start у фото — не приветствие", async () => {
    expect(await answer(await worker.fetch(post(message({ caption: "/start" })), env))).toBe(UNREAD);
  });

  it("текст не строкой получает короткий ответ, а не сбой", async () => {
    expect(await answer(await worker.fetch(post(message({ text: 5 })), env))).toBe(UNREAD);
  });

  it("короткий ответ — текст из спеки", () => {
    expect(UNREAD).toBe("Сообщения боту пока не читаются. Τετράδιο открывается кнопкой ниже.");
  });
});

describe("молчание", () => {
  it.each(["group", "supergroup", "channel"])("сообщение из чата %s остаётся без ответа", async (type) => {
    await silent(await worker.fetch(post(message({ text: "/start" }, { id: -1, type })), env));
  });

  it("правка сообщения остаётся без ответа", async () => {
    const edited = { update_id: 2, edited_message: { message_id: 7, date: 0, chat: { id: 42, type: "private" } } };
    await silent(await worker.fetch(post(edited), env));
  });

  it("нажатие инлайн-кнопки остаётся без ответа", async () => {
    await silent(await worker.fetch(post({ update_id: 3, callback_query: { id: "1", data: "x" } }), env));
  });

  it.each(["not json", "null", "5", '"text"', "[]", '{"message":null}'])(
    "тело %s остаётся без ответа",
    async (body) => {
      await silent(await worker.fetch(post(body), env));
    },
  );
});

describe("проверка запроса", () => {
  it("без заголовка секрета — 401", async () => {
    await silent(await worker.fetch(post(message({ text: "/start" }), {}), env), 401);
  });

  it("с неверным секретом — 401", async () => {
    const wrong = { "X-Telegram-Bot-Api-Secret-Token": "other" };
    await silent(await worker.fetch(post(message({ text: "/start" }), wrong), env), 401);
  });

  it.each([undefined, ""])("секрет Worker не задан (%j) — 401 с заголовком и без", async (secret) => {
    const bare = { APP_URL, WEBHOOK_SECRET: secret };
    await silent(await worker.fetch(post(message({ text: "/start" })), bare), 401);
    await silent(await worker.fetch(post(message({ text: "/start" }), {}), bare), 401);
    await silent(
      await worker.fetch(post(message({ text: "/start" }), { "X-Telegram-Bot-Api-Secret-Token": "" }), bare),
      401,
    );
  });

  it("GET — 405", async () => {
    await silent(await worker.fetch(new Request("https://bot.example.workers.dev/"), env), 405);
  });
});

describe("обратная связь настроена", () => {
  const TOKEN = "123:secret-token";
  const configured = () => ({ ...env, BOT_TOKEN: TOKEN, SUPPORT_CHAT_ID: "-1004455365743", FEEDBACK: sqlite() });

  it("/start feedback — приглашение в теле ответа", async () => {
    const response = await worker.fetch(post(message({ text: "/start feedback" })), configured());
    expect(await response.json()).toEqual({ method: "sendMessage", chat_id: 42, text: INVITE });
  });

  it("без токена /start feedback — приветствие, как до обратной связи", async () => {
    expect(await answer(await worker.fetch(post(message({ text: "/start feedback" })), env))).toBe(GREETING);
  });

  it("Bot API недоступен — текст о сбое без токена", async () => {
    const offline = (async (url: string) => {
      throw new TypeError(`fetch failed: ${url}`);
    }) as unknown as typeof fetch;
    const reply = await respond(message({ text: "привет" }) as unknown as Update, configured(), offline);
    expect(reply).toEqual({ method: "sendMessage", chat_id: 42, text: FAILED });
    expect(JSON.stringify(reply)).not.toContain(TOKEN);
  });

  it("исключение при обработке — 200 без тела", async () => {
    const broken = configured();
    Object.defineProperty(broken, "SUPPORT_CHAT_ID", {
      get: () => {
        throw new Error("config unavailable");
      },
    });
    await silent(await worker.fetch(post(message({ text: "привет" })), broken));
  });
});

describe("форма приложения: /feedback", () => {
  const TOKEN = "123:secret-token";
  const ORIGIN = "https://tetradio.app";
  const USER = JSON.stringify({ id: 42, first_name: "Мария" });
  const signed = (authDate = Math.floor(Date.now() / 1000) - 60) => {
    const fields: Record<string, string> = { auth_date: String(authDate), user: USER };
    const check = Object.keys(fields)
      .sort()
      .map((key) => `${key}=${fields[key]}`)
      .join("\n");
    const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
    return new URLSearchParams({
      ...fields,
      hash: createHmac("sha256", secret).update(check).digest("hex"),
    }).toString();
  };
  const formEnv = () => ({
    ...env,
    BOT_TOKEN: TOKEN,
    SUPPORT_CHAT_ID: "-1004455365743",
    FEEDBACK: sqlite(),
    APP_ORIGINS: ORIGIN,
  });
  const request = (body: unknown, origin = ORIGIN, method = "POST") =>
    new Request("https://bot.example.workers.dev/feedback", {
      method,
      headers: { "Content-Type": "text/plain", ...(origin ? { Origin: origin } : {}) },
      ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
  const form = (fields: Record<string, unknown> = {}) => ({
    initData: signed(),
    text: "Опечатка",
    version: "0.1.0 (abc)",
    platform: "ios",
    ...fields,
  });
  const telegram = () => {
    const calls: string[] = [];
    const fetcher = (async (url: string, init: { body: string }) => {
      calls.push(`${url.split("/").pop()} ${init.body}`);
      return Response.json({ ok: true, result: { message_thread_id: 100, message_id: 1 } });
    }) as unknown as typeof fetch;
    return { calls, fetcher };
  };

  it("предзапрос с адреса приложения — разрешения CORS", async () => {
    const response = await feedbackForm(request(null, ORIGIN, "OPTIONS"), formEnv());
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST");
  });

  it.each([["https://evil.example"], [""]])("чужой адрес %j — 403 без CORS", async (origin) => {
    const bot = telegram();
    const response = await feedbackForm(request(form(), origin), formEnv(), bot.fetcher);
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(bot.calls).toEqual([]);
  });

  it("верная форма — 200 и сообщение в теме", async () => {
    const bot = telegram();
    const response = await feedbackForm(request(form()), formEnv(), bot.fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(bot.calls.map((call) => call.split(" ")[0])).toEqual(["createForumTopic", "sendMessage", "sendMessage"]);
    expect(bot.calls[2]).toContain("Из приложения · 0.1.0 (abc) · ios");
  });

  it("повтор в 10 секунд — 429", async () => {
    const bot = telegram();
    const configuredEnv = formEnv();
    await feedbackForm(request(form()), configuredEnv, bot.fetcher);
    const response = await feedbackForm(request(form()), configuredEnv, bot.fetcher);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate" });
  });

  it.each([
    ["неверная подпись", { initData: signed().replace(/hash=[0-9a-f]+/, `hash=${"0".repeat(64)}`) }, 401, "stale"],
    ["старше 7 суток", { initData: signed(Math.floor(Date.now() / 1000) - 8 * 24 * 3600) }, 401, "stale"],
    ["пустой текст", { text: " " }, 400, "invalid"],
  ])("%s — %i", async (_, fields, status, error) => {
    const bot = telegram();
    const response = await feedbackForm(request(form(fields)), formEnv(), bot.fetcher);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(bot.calls).toEqual([]);
  });

  it("Bot API отказал — 502", async () => {
    const refusing = (async () =>
      Response.json({ ok: false, error_code: 400, description: "Bad Request" })) as unknown as typeof fetch;
    const response = await feedbackForm(request(form()), formEnv(), refusing);
    expect(response.status).toBe(502);
  });

  it("без токена бота — 503", async () => {
    const response = await feedbackForm(request(form()), { ...formEnv(), BOT_TOKEN: undefined });
    expect(response.status).toBe(503);
  });

  it("тело больше 16 КБ — 400, в том числе без Content-Length", async () => {
    const bot = telegram();
    const big = JSON.stringify(form({ text: "a".repeat(17 * 1024) }));
    const declared = await feedbackForm(request(big), formEnv(), bot.fetcher);
    expect(declared.status).toBe(400);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const chunked = new Request("https://bot.example.workers.dev/feedback", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: ORIGIN },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await feedbackForm(chunked, formEnv(), bot.fetcher)).status).toBe(400);
    expect(bot.calls).toEqual([]);
  });

  it("worker.fetch ведёт /feedback в обработчик формы", async () => {
    const response = await worker.fetch(request(null, ORIGIN, "OPTIONS"), formEnv());
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("исключение в обработчике формы — 502", async () => {
    const broken = {
      ...formEnv(),
      FEEDBACK: {
        prepare: () => {
          throw new Error("D1 down");
        },
      },
    };
    const response = await worker.fetch(request(form()), broken as unknown as Parameters<typeof worker.fetch>[1]);
    expect(response.status).toBe(502);
  });

  it("/forget: верная подпись — тема удалена, 200; чужой адрес — 403; неверная подпись — 401", async () => {
    const forgetRequest = (body: unknown, origin = ORIGIN) =>
      new Request("https://bot.example.workers.dev/forget", {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: origin },
        body: JSON.stringify(body),
      });
    const configuredEnv = formEnv();
    const bot = telegram();
    await feedbackForm(request(form()), configuredEnv, bot.fetcher);
    bot.calls.length = 0;
    const ok = await forgetRoute(forgetRequest({ initData: signed() }), configuredEnv, bot.fetcher);
    expect(ok.status).toBe(200);
    expect(bot.calls.map((call) => call.split(" ")[0])).toEqual(["deleteForumTopic"]);
    expect(
      (await forgetRoute(forgetRequest({ initData: signed() }, "https://evil.example"), configuredEnv, bot.fetcher))
        .status,
    ).toBe(403);
    const forged = signed().replace(/hash=[0-9a-f]+/, `hash=${"0".repeat(64)}`);
    expect((await forgetRoute(forgetRequest({ initData: forged }), configuredEnv, bot.fetcher)).status).toBe(401);
    expect((await forgetRoute(forgetRequest({}), configuredEnv, bot.fetcher)).status).toBe(400);
  });

  it("worker.fetch ведёт /forget в обработчик удаления", async () => {
    const response = await worker.fetch(
      new Request("https://bot.example.workers.dev/forget", { method: "OPTIONS", headers: { Origin: ORIGIN } }),
      formEnv(),
    );
    expect(response.status).toBe(204);
  });

  it("вебхук на / по-прежнему требует секрет", async () => {
    await silent(await worker.fetch(post(message({ text: "/start" }), {}), formEnv()), 401);
  });
});
