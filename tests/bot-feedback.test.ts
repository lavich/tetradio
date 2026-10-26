import { describe, expect, it } from "vitest";
import { fromForm, handle, type Answer, type Deps, type Form, type Message } from "../bot/feedback";
import { emptyRow, type Row, type Store } from "../bot/store";
import { ACK, BLOCKED, FAILED, GREETING, INVITE, UNBLOCKED, UNKNOWN_COMMAND } from "../bot/texts";

const GROUP = -1004455365743;
const USER = 42;
const NOW = Date.UTC(2026, 9, 26, 12);
const DAY = 24 * 60 * 60 * 1000;
const REPORT = "0123456789abcdef0123456789abcdef";

function memoryStore(rows: Row[] = []) {
  const byId = new Map(rows.map((row) => [row.userId, { ...row }]));
  let failing = false;
  const guard = () => {
    if (failing) throw new Error("D1 unavailable");
  };
  const write = (userId: number, fields: Partial<Row>) => {
    guard();
    store.saves++;
    byId.set(userId, { ...(byId.get(userId) ?? emptyRow(userId)), ...fields });
  };
  const store: Store & { rows: Map<number, Row>; saves: number; fail(): void } = {
    rows: byId,
    saves: 0,
    fail: () => {
      failing = true;
    },
    byUser: async (userId) => {
      guard();
      return byId.get(userId) ?? null;
    },
    byThread: async (thread) => {
      guard();
      return [...byId.values()].find((row) => row.thread === thread) ?? null;
    },
    setThread: async (userId, thread) => write(userId, { thread }),
    setAck: async (userId, ackAt) => write(userId, { ackAt }),
    setFb: async (userId, fb, fbAt) => write(userId, { fb, fbAt }),
    setBlocked: async (userId, blocked) => write(userId, { blocked }),
    claimForm: async (userId, now, interval) => {
      guard();
      const formAt = byId.get(userId)?.formAt ?? null;
      if (formAt !== null && formAt > now - interval) return false;
      write(userId, { formAt: now });
      return true;
    },
  };
  return store;
}

function telegram(answers: Record<string, Answer[]> = {}) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let nextThread = 100;
  const api = async (method: string, body: object): Promise<Answer> => {
    calls.push({ method, body: body as Record<string, unknown> });
    const queued = answers[method]?.shift();
    if (queued) return queued;
    if (method === "createForumTopic") return { ok: true, result: { message_thread_id: nextThread++ } };
    return { ok: true, result: { message_id: 1 } };
  };
  return { api, calls, methods: () => calls.map((call) => call.method) };
}

function setup(rows: Row[] = [], answers: Record<string, Answer[]> = {}, now = NOW) {
  const bot = telegram(answers);
  const store = memoryStore(rows);
  const slept: number[] = [];
  const deps: Deps = {
    api: bot.api,
    store,
    supportChatId: String(GROUP),
    sentryEventUrl: "https://storewizard.sentry.io/projects/tetradio/events/",
    appUrl: "https://tetradio.app/app/",
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
    },
  };
  return { bot, store, deps, slept };
}

const row = (fields: Partial<Row> = {}): Row => ({ ...emptyRow(USER), thread: 7, ...fields });

let id = 1;
const fromUser = (fields: Record<string, unknown> = { text: "привет" }): { message: Message } => ({
  message: {
    message_id: id++,
    chat: { id: USER, type: "private" },
    from: { id: USER, first_name: "Мария", last_name: "Π.", username: "maria", language_code: "ru" },
    ...fields,
  },
});
const inTopic = (fields: Record<string, unknown>, thread = 7): { message: Message } => ({
  message: {
    message_id: id++,
    chat: { id: GROUP, type: "supergroup" },
    from: { id: 1, first_name: "Автор" },
    message_thread_id: thread,
    is_topic_message: true,
    ...fields,
  },
});

describe("start", () => {
  it("приветствие с кнопкой без обращений к Bot API", async () => {
    const { bot, deps } = setup();
    const reply = await handle(fromUser({ text: "/start w_x" }), deps);
    expect(reply).toMatchObject({ method: "sendMessage", chat_id: USER, text: GREETING });
    expect(reply?.reply_markup).toBeDefined();
    expect(bot.calls).toEqual([]);
  });

  it.each(["/start feedback", "/start@TetradioBot feedback"])("%s — приглашение", async (text) => {
    const { bot, deps } = setup();
    expect(await handle(fromUser({ text }), deps)).toMatchObject({ text: INVITE });
    expect(bot.calls).toEqual([]);
  });

  it("fb_ с id отчёта запоминает отчёт на сутки", async () => {
    const { store, deps } = setup();
    expect(await handle(fromUser({ text: `/start fb_${REPORT}` }), deps)).toMatchObject({ text: INVITE });
    expect(store.rows.get(USER)).toMatchObject({ fb: REPORT, fbAt: NOW, thread: null });
  });

  it("повторный fb_ с тем же id и fb_ заблокированного ничего не пишут", async () => {
    const same = setup([row({ fb: REPORT, fbAt: NOW })]);
    await handle(fromUser({ text: `/start fb_${REPORT}` }), same.deps);
    expect(same.store.saves).toBe(0);
    const blocked = setup([row({ blocked: true })]);
    await handle(fromUser({ text: `/start fb_${REPORT}` }), blocked.deps);
    expect(blocked.store.saves).toBe(0);
  });

  it("fb_ не того формата — приветствие", async () => {
    const { store, deps } = setup();
    expect(await handle(fromUser({ text: "/start fb_xyz" }), deps)).toMatchObject({ text: GREETING });
    expect(store.saves).toBe(0);
  });
});

describe("сообщение пользователя", () => {
  it("первое: тема, связь одной записью, шапка, копия, подтверждение текстом", async () => {
    const { bot, store, deps } = setup();
    const update = fromUser();
    const reply = await handle(update, deps);
    expect(bot.methods()).toEqual(["createForumTopic", "sendMessage", "copyMessage"]);
    expect(bot.calls[0].body).toEqual({ chat_id: GROUP, name: "Мария Π. (@maria)" });
    expect(bot.calls[1].body).toEqual({
      chat_id: GROUP,
      message_thread_id: 100,
      text: "Мария Π.\n@maria\nid: 42\nязык: ru",
    });
    expect(bot.calls[2].body).toEqual({
      chat_id: GROUP,
      message_thread_id: 100,
      from_chat_id: USER,
      message_id: update.message.message_id,
    });
    expect(reply).toEqual({ method: "sendMessage", chat_id: USER, text: ACK });
    expect(store.rows.get(USER)).toEqual(row({ thread: 100, ackAt: NOW }));
    expect(store.saves).toBe(2);
  });

  it("в хранилище нет текстов сообщений", async () => {
    const { store, deps } = setup();
    await handle(fromUser({ text: "секретный текст" }), deps);
    expect(JSON.stringify([...store.rows.values()])).not.toContain("секретный");
  });

  it("имя темы без фамилии и username, длинное — до 128 символов", async () => {
    const plain = setup();
    await handle(fromUser({ from: { id: USER, first_name: "Анна" } }), plain.deps);
    expect(plain.bot.calls[0].body.name).toBe("Анна");
    expect(plain.bot.calls[1].body.text).toBe("Анна\nбез username\nid: 42");
    const long = setup();
    await handle(
      fromUser({ from: { id: USER, first_name: "Я".repeat(64), last_name: "Ж".repeat(64), username: "u".repeat(32) } }),
      long.deps,
    );
    expect(String(long.bot.calls[0].body.name)).toHaveLength(128);
  });

  it("следующее в течение суток: копия в тему и реакция без записи", async () => {
    const { bot, store, deps } = setup([row({ ackAt: NOW - 1000 })]);
    const update = fromUser();
    const reply = await handle(update, deps);
    expect(bot.methods()).toEqual(["copyMessage"]);
    expect(reply).toEqual({
      method: "setMessageReaction",
      chat_id: USER,
      message_id: update.message.message_id,
      reaction: [{ type: "emoji", emoji: "👍" }],
    });
    expect(store.saves).toBe(0);
  });

  it("через сутки — снова текст", async () => {
    const { store, deps } = setup([row({ ackAt: NOW - DAY })]);
    expect(await handle(fromUser(), deps)).toMatchObject({ text: ACK });
    expect(store.rows.get(USER)?.ackAt).toBe(NOW);
  });

  it("альбом нового пользователя — одна тема, один текст, остальным реакция", async () => {
    const { bot, deps } = setup();
    const replies = [];
    for (let i = 0; i < 3; i++) replies.push(await handle(fromUser({ media_group_id: "a", photo: [] }), deps));
    expect(bot.methods().filter((method) => method === "createForumTopic")).toHaveLength(1);
    expect(replies.map((reply) => reply?.method)).toEqual(["sendMessage", "setMessageReaction", "setMessageReaction"]);
  });

  it("ссылка на отчёт перед копией, затем отчёт стирается", async () => {
    const { bot, store, deps } = setup([row({ fb: REPORT, fbAt: NOW - 1000, ackAt: NOW - 1000 })]);
    await handle(fromUser(), deps);
    expect(bot.methods()).toEqual(["sendMessage", "copyMessage"]);
    expect(bot.calls[0].body.text).toBe(`Отчёт: https://storewizard.sentry.io/projects/tetradio/events/${REPORT}/`);
    expect(store.rows.get(USER)).toMatchObject({ fb: null, fbAt: null });
  });

  it("отчёт старше суток в тему не идёт", async () => {
    const { bot, deps } = setup([row({ fb: REPORT, fbAt: NOW - DAY, ackAt: NOW - 1000 })]);
    await handle(fromUser(), deps);
    expect(bot.methods()).toEqual(["copyMessage"]);
  });

  it("удалённая тема: новая тема и повтор копии", async () => {
    const thread404 = { ok: false, error_code: 400, description: "Bad Request: message thread not found" };
    const { bot, store, deps } = setup([row({ ackAt: NOW - 1000 })], { copyMessage: [thread404] });
    expect(await handle(fromUser(), deps)).toMatchObject({ method: "setMessageReaction" });
    expect(bot.methods()).toEqual(["copyMessage", "createForumTopic", "sendMessage", "copyMessage"]);
    expect(store.rows.get(USER)?.thread).toBe(100);
  });

  it("удалённая тема при неотправленной ссылке на отчёт: новая тема, ссылка и копия в ней", async () => {
    const thread404 = { ok: false, error_code: 400, description: "Bad Request: message thread not found" };
    const { bot, store, deps } = setup([row({ fb: REPORT, fbAt: NOW - 1000, ackAt: NOW - 1000 })], {
      sendMessage: [thread404],
    });
    expect(await handle(fromUser(), deps)).toMatchObject({ method: "setMessageReaction" });
    expect(bot.methods()).toEqual(["sendMessage", "createForumTopic", "sendMessage", "sendMessage", "copyMessage"]);
    expect(bot.calls[3].body).toMatchObject({ message_thread_id: 100, text: expect.stringContaining(REPORT) });
    expect(store.rows.get(USER)).toMatchObject({ thread: 100, fb: null });
  });

  it("без адреса Sentry в тему идёт идентификатор отчёта", async () => {
    const { bot, deps } = setup([row({ fb: REPORT, fbAt: NOW - 1000, ackAt: NOW - 1000 })]);
    await handle(fromUser(), { ...deps, sentryEventUrl: "" });
    expect(bot.calls[0].body.text).toBe(`Отчёт: ${REPORT}`);
  });

  it.each(["chat_background_set", "pinned_message", "message_auto_delete_timer_changed"])(
    "служебное %s в личном чате — без темы и без ответа",
    async (key) => {
      const { bot, store, deps } = setup();
      expect(await handle(fromUser({ [key]: {} }), deps)).toBeNull();
      expect(bot.calls).toEqual([]);
      expect(store.saves).toBe(0);
    },
  );

  it("сообщение без from — тема по id, шапка «без имени»", async () => {
    const { bot, deps } = setup();
    await handle(fromUser({ from: undefined }), deps);
    expect(bot.calls[0].body.name).toBe("id 42");
    expect(bot.calls[1].body.text).toBe("без имени\nбез username\nid: 42");
  });

  it("команда пользователя, кроме start, пересылается", async () => {
    const { bot, deps } = setup([row({ ackAt: NOW - 1000 })]);
    await handle(fromUser({ text: "/help" }), deps);
    expect(bot.methods()).toEqual(["copyMessage"]);
  });

  it("заблокированный получает приветствие на /start", async () => {
    const { deps } = setup([row({ blocked: true })]);
    expect(await handle(fromUser({ text: "/start" }), deps)).toMatchObject({ text: GREETING });
  });

  it("429 с коротким ожиданием — ждёт и повторяет", async () => {
    const limited = { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 3 } };
    const { bot, deps, slept } = setup([row({ ackAt: NOW - 1000 })], { copyMessage: [limited] });
    expect(await handle(fromUser(), deps)).toMatchObject({ method: "setMessageReaction" });
    expect(slept).toEqual([3000]);
    expect(bot.methods()).toEqual(["copyMessage", "copyMessage"]);
  });

  it("429 с долгим ожиданием — сбой без ожидания", async () => {
    const limited = { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 30 } };
    const { deps, slept } = setup([row()], { copyMessage: [limited] });
    expect(await handle(fromUser(), deps)).toMatchObject({ text: FAILED });
    expect(slept).toEqual([]);
  });

  it("копирование отклонено — сбой, подтверждение не записано", async () => {
    const refused = { ok: false, error_code: 400, description: "Bad Request: message can't be copied" };
    const { store, deps } = setup([row()], { copyMessage: [refused] });
    expect(await handle(fromUser({ invoice: {} }), deps)).toMatchObject({ text: FAILED });
    expect(store.rows.get(USER)?.ackAt).toBeNull();
  });

  it("неверный токен — текст о сбое в ответе на вебхук", async () => {
    const unauthorized = { ok: false, error_code: 401, description: "Unauthorized" };
    const { deps } = setup([], { createForumTopic: [unauthorized] });
    expect(await handle(fromUser(), deps)).toEqual({ method: "sendMessage", chat_id: USER, text: FAILED });
  });

  it("хранилище недоступно — сбой без обращений к Bot API", async () => {
    const { bot, store, deps } = setup();
    store.fail();
    expect(await handle(fromUser(), deps)).toMatchObject({ text: FAILED });
    expect(bot.calls).toEqual([]);
  });

  it("связь не сохранилась после создания темы — сбой", async () => {
    const { store, deps } = setup();
    store.setThread = async () => {
      throw new Error("limit");
    };
    expect(await handle(fromUser(), deps)).toMatchObject({ text: FAILED });
  });

  it("заблокированный — без пересылки и без ответа", async () => {
    const { bot, deps } = setup([row({ blocked: true })]);
    expect(await handle(fromUser(), deps)).toBeNull();
    expect(bot.calls).toEqual([]);
  });
});

describe("сообщение в группе поддержки", () => {
  it("ответ автора копируется пользователю без подписи", async () => {
    const { bot, deps } = setup([row()]);
    const update = inTopic({ text: "Спасибо, исправлю" });
    expect(await handle(update, deps)).toBeNull();
    expect(bot.calls).toEqual([
      { method: "copyMessage", body: { chat_id: USER, from_chat_id: GROUP, message_id: update.message.message_id } },
    ]);
  });

  it("анонимный администратор — тоже ответ", async () => {
    const { bot, deps } = setup([row()]);
    await handle(inTopic({ text: "ок", from: { id: 1087968824, is_bot: true }, sender_chat: { id: GROUP } }), deps);
    expect(bot.methods()).toEqual(["copyMessage"]);
  });

  it("пользователь заблокировал бота — «Не доставлено» в теме", async () => {
    const forbidden = { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
    const { deps } = setup([row()], { copyMessage: [forbidden] });
    expect(await handle(inTopic({ text: "ответ" }), deps)).toEqual({
      method: "sendMessage",
      chat_id: GROUP,
      message_thread_id: 7,
      text: "Не доставлено: Forbidden: bot was blocked by the user",
    });
  });

  it.each([
    ["/block", true, BLOCKED],
    ["/Block", true, BLOCKED],
    ["/block@TetradioBot", true, BLOCKED],
    ["/unblock", false, UNBLOCKED],
  ])("%s", async (text, blocked, answer) => {
    const { bot, store, deps } = setup([row({ blocked: !blocked })]);
    expect(await handle(inTopic({ text }), deps)).toMatchObject({ message_thread_id: 7, text: answer });
    expect(store.rows.get(USER)?.blocked).toBe(blocked);
    expect(bot.calls).toEqual([]);
  });

  it("хранилище недоступно — сказано в теме", async () => {
    const { store, deps } = setup([row()]);
    store.fail();
    expect(await handle(inTopic({ text: "ответ" }), deps)).toMatchObject({
      message_thread_id: 7,
      text: "Не доставлено: хранилище связей недоступно",
    });
  });

  it("блокировка не сохранилась — сказано в теме", async () => {
    const { store, deps } = setup([row()]);
    store.setBlocked = async () => {
      throw new Error("D1 unavailable");
    };
    expect(await handle(inTopic({ text: "/block" }), deps)).toMatchObject({
      text: "Не доставлено: не удалось сохранить блокировку",
    });
  });

  it("Bot API недоступен при ответе автора — без текста исключения", async () => {
    const { deps } = setup([row()]);
    const token = "123:secret";
    deps.api = async (method) => {
      throw new TypeError(`fetch failed: https://api.telegram.org/bot${token}/${method}`);
    };
    const reply = await handle(inTopic({ text: "ответ" }), deps);
    expect(reply).toMatchObject({ text: "Не доставлено: Bot API недоступен" });
    expect(JSON.stringify(reply)).not.toContain(token);
  });

  it("неизвестная команда не уходит пользователю", async () => {
    const { bot, deps } = setup([row()]);
    expect(await handle(inTopic({ text: "/blok" }), deps)).toMatchObject({ text: UNKNOWN_COMMAND });
    expect(bot.calls).toEqual([]);
  });

  it.each([
    ["общая тема", { is_topic_message: undefined, message_thread_id: undefined, text: "x" }],
    ["служебное сообщение", { forum_topic_created: { name: "x" } }],
    ["другой бот", { text: "x", from: { id: 5, is_bot: true } }],
    ["тема без пользователя", { text: "x", message_thread_id: 999 }],
  ])("%s — без ответа", async (_, fields) => {
    const { bot, deps } = setup([row()]);
    expect(await handle(inTopic(fields), deps)).toBeNull();
    expect(bot.calls).toEqual([]);
  });

  it("другая группа — без ответа", async () => {
    const { bot, deps } = setup([row()]);
    const update = inTopic({ text: "x" });
    update.message.chat = { id: -100999, type: "supergroup" };
    expect(await handle(update, deps)).toBeNull();
    expect(bot.calls).toEqual([]);
  });
});

describe("сообщение из формы приложения", () => {
  const form = (fields: Partial<Form> = {}): Form => ({
    user: { id: USER, first_name: "Мария", username: "maria", language_code: "ru" },
    text: "Опечатка в уроке 3",
    version: "0.1.0 (abc123)",
    platform: "ios",
    reportId: null,
    canReply: true,
    ...fields,
  });

  it("новый пользователь: тема, шапка, текст с пометкой; подтверждения в чат нет", async () => {
    const { bot, store, deps } = setup();
    expect(await fromForm(form(), deps)).toBe("ok");
    expect(bot.methods()).toEqual(["createForumTopic", "sendMessage", "sendMessage"]);
    expect(bot.calls[2].body).toEqual({
      chat_id: GROUP,
      message_thread_id: 100,
      text: "Из приложения · 0.1.0 (abc123) · ios\n\nОпечатка в уроке 3",
    });
    expect(store.rows.get(USER)).toMatchObject({ thread: 100, formAt: NOW, ackAt: null });
  });

  it("существующая тема, отчёт и запрет писать пользователю", async () => {
    const { bot, deps } = setup([row()]);
    expect(await fromForm(form({ reportId: REPORT, canReply: false }), deps)).toBe("ok");
    expect(bot.methods()).toEqual(["sendMessage", "sendMessage"]);
    expect(bot.calls[0].body.text).toBe(`Отчёт: https://storewizard.sentry.io/projects/tetradio/events/${REPORT}/`);
    expect(bot.calls[1].body.text).toBe(
      "Из приложения · 0.1.0 (abc123) · ios\nответить нельзя: бот не может писать пользователю\n\nОпечатка в уроке 3",
    );
  });

  it("удалённая тема — новая тема и повтор", async () => {
    const thread404 = { ok: false, error_code: 400, description: "Bad Request: message thread not found" };
    const { bot, deps } = setup([row()], { sendMessage: [thread404] });
    expect(await fromForm(form(), deps)).toBe("ok");
    expect(bot.methods()).toEqual(["sendMessage", "createForumTopic", "sendMessage", "sendMessage"]);
  });

  it("чаще раза в 10 секунд — rate, в группу ничего", async () => {
    const { bot, deps } = setup([row({ formAt: NOW - 9_000 })]);
    expect(await fromForm(form(), deps)).toBe("rate");
    expect(bot.calls).toEqual([]);
  });

  it("два одновременных запроса — одно сообщение", async () => {
    const { bot, deps } = setup([row()]);
    const results = await Promise.all([fromForm(form(), deps), fromForm(form(), deps)]);
    expect(results.sort()).toEqual(["ok", "rate"]);
    expect(bot.methods()).toEqual(["sendMessage"]);
  });

  it("заблокированный — ok без отправки", async () => {
    const { bot, deps } = setup([row({ blocked: true })]);
    expect(await fromForm(form(), deps)).toBe("ok");
    expect(bot.calls).toEqual([]);
  });

  it("сбой Bot API или хранилища — failed", async () => {
    const refused = { ok: false, error_code: 400, description: "Bad Request: chat not found" };
    expect(await fromForm(form(), setup([row()], { sendMessage: [refused] }).deps)).toBe("failed");
    const broken = setup();
    broken.store.fail();
    expect(await fromForm(form(), broken.deps)).toBe("failed");
  });
});
