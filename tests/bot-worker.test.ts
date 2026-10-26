import { describe, expect, it } from "vitest";
import worker, { GREETING, UNREAD } from "../bot/worker";

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
