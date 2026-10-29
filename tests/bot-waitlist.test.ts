import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import worker, { feedbackForm, forgetRoute, waitlistRoute, type Background, type Env } from "../bot/worker";
import { handle, type Answer, type Deps, type Message } from "../bot/feedback";
import { databaseStore, waitlistStore, type Database } from "../bot/store";
import { NOTIFY_TOO_LONG } from "../bot/texts";
import { sqlite } from "./helpers/sqlite-d1";

const TOKEN = "123:secret-token";
const ORIGIN = "https://tetradio.app";
const GROUP = -1004455365743;
const THREAD = 555;
const USER = 42;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 27, 12);

const signed = (user: object = { id: USER, first_name: "Мария", username: "maria" }, token = TOKEN) => {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000) - 60),
    user: JSON.stringify(user),
  };
  const check = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
};

const rows = (database: Database, query: string, ...values: unknown[]) =>
  database
    .prepare(query)
    .bind(...values)
    .all<Record<string, unknown>>()
    .then((result) => result.results);

function telegram(answer: (method: string, body: Record<string, unknown>) => unknown = () => null) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string, init: { body: string }) => {
    const method = url.split("/").pop()!;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ method, body });
    return Response.json((await answer(method, body)) ?? { ok: true, result: { message_id: 1, message_thread_id: 7 } });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

function background(): Background & { settled(): Promise<unknown> } {
  const tasks: Promise<unknown>[] = [];
  return { waitUntil: (promise) => tasks.push(promise), settled: () => Promise.all(tasks) };
}

describe("заявка: POST /waitlist", () => {
  let database: Database;
  const env = () => ({
    APP_URL: "https://tetradio.app/app/",
    BOT_TOKEN: TOKEN,
    SUPPORT_CHAT_ID: String(GROUP),
    FEEDBACK: database,
    APP_ORIGINS: ORIGIN,
    WAITLIST_THREAD: String(THREAD),
    WAITLIST_COURSES: "greek-b1, greek-b2",
  });
  const request = (body: unknown, origin: string | null = ORIGIN, path = "/waitlist") =>
    new Request(`https://bot.example.workers.dev${path}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", ...(origin ? { Origin: origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const send = async (
    body: Record<string, unknown>,
    bot = telegram(),
    ctx = background(),
    environment: object = env(),
  ) => {
    const response = await waitlistRoute(
      request({ initData: signed(), ...body }),
      environment as Env,
      bot.fetcher,
      ctx,
    );
    await ctx.settled();
    return { status: response.status, json: (await response.json()) as unknown };
  };
  const lines = (bot: ReturnType<typeof telegram>) => bot.calls.filter((call) => call.method === "sendMessage");
  const join = { action: "join", course: "greek-b1" };
  const leave = { action: "leave", course: "greek-b1" };
  const at = (ms: number) => vi.setSystemTime(NOW + ms);

  beforeEach(() => {
    database = sqlite();
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("новая заявка: строка в D1, joined: true, строка «+1» в теме заявок без имени и id", async () => {
    const bot = telegram();
    expect(await send(join, bot)).toEqual({ status: 200, json: { ok: true, joined: true } });
    expect(await rows(database, "SELECT user_id, course, at, notified_at FROM waitlist")).toEqual([
      { user_id: USER, course: "greek-b1", at: NOW, notified_at: null },
    ]);
    expect(lines(bot)).toEqual([
      {
        method: "sendMessage",
        body: { chat_id: GROUP, message_thread_id: THREAD, text: "+1 · greek-b1 · всего 1" },
      },
    ]);
    expect(JSON.stringify(bot.calls)).not.toMatch(/Мария|maria|42/);
  });

  it("всего N — число записей курса", async () => {
    await waitlistStore(database).join(7, "greek-b1", 1);
    const bot = telegram();
    await send(join, bot);
    expect(lines(bot)[0].body.text).toBe("+1 · greek-b1 · всего 2");
  });

  it("повторная заявка через минуту — одна строка в D1, joined: true, новой строки в группе нет", async () => {
    const bot = telegram();
    await send(join, bot);
    at(60_000);
    expect(await send(join, bot)).toEqual({ status: 200, json: { ok: true, joined: true } });
    expect(await rows(database, "SELECT * FROM waitlist")).toHaveLength(1);
    expect(lines(bot)).toHaveLength(1);
  });

  it("join и leave трижды за 5 секунд — второй и третий 429, одна строка «+1»", async () => {
    const bot = telegram();
    expect((await send(join, bot)).status).toBe(200);
    at(1000);
    expect(await send(leave, bot)).toEqual({ status: 429, json: { error: "rate" } });
    at(2000);
    expect((await send(join, bot)).status).toBe(429);
    expect(lines(bot)).toHaveLength(1);
    expect(await rows(database, "SELECT * FROM waitlist")).toHaveLength(1);
  });

  it("10 переключений за 10 минут — одна строка", async () => {
    const bot = telegram();
    for (let i = 0; i < 10; i++) {
      at(i * 6000);
      expect((await send(i % 2 ? leave : join, bot)).status).toBe(200);
    }
    expect(lines(bot)).toHaveLength(1);
    at(10 * 60_000 + 6000);
    await send(join, bot);
    expect(lines(bot)).toHaveLength(2);
  });

  it("отмена: joined: false, строки нет, в группу ничего", async () => {
    const bot = telegram();
    await send(join, bot);
    at(6000);
    expect(await send(leave, bot)).toEqual({ status: 200, json: { ok: true, joined: false } });
    expect(await rows(database, "SELECT * FROM waitlist")).toEqual([]);
    expect(lines(bot)).toHaveLength(1);
  });

  it("status — joined без учёта частоты и без строк в группе", async () => {
    const bot = telegram();
    const status = { action: "status", course: "greek-b1" };
    expect(await send(status, bot)).toEqual({ status: 200, json: { ok: true, joined: false } });
    await send(join, bot);
    expect(await send(status, bot)).toEqual({ status: 200, json: { ok: true, joined: true } });
    expect(await send({ action: "status", course: "greek-b2" }, bot)).toEqual({
      status: 200,
      json: { ok: true, joined: false },
    });
    expect(lines(bot)).toHaveLength(1);
  });

  it("заблокированный автором: заявка сохраняется, строки в группе нет", async () => {
    await databaseStore(database).setBlocked(USER, true);
    const bot = telegram();
    expect(await send(join, bot)).toEqual({ status: 200, json: { ok: true, joined: true } });
    expect(await rows(database, "SELECT * FROM waitlist")).toHaveLength(1);
    expect(bot.calls).toEqual([]);
  });

  it("без WAITLIST_THREAD строки нет", async () => {
    const bot = telegram();
    expect((await send(join, bot, background(), { ...env(), WAITLIST_THREAD: "" })).status).toBe(200);
    expect(bot.calls).toEqual([]);
  });

  it("строка уходит после ответа: ответ не ждёт Telegram", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const bot = telegram(() => held.then(() => null));
    const ctx = background();
    const response = await waitlistRoute(request({ initData: signed(), ...join }), env(), bot.fetcher, ctx);
    expect(await response.json()).toEqual({ ok: true, joined: true });
    release();
    await ctx.settled();
    expect(lines(bot)).toHaveLength(1);
  });

  it.each([
    ["Telegram отказал", () => ({ ok: false, error_code: 400, description: "Bad Request: message thread not found" })],
    [
      "Bot API недоступен",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("сбой строки (%s) не отменяет записи", async (_, answer) => {
    expect(await send(join, telegram(answer))).toEqual({ status: 200, json: { ok: true, joined: true } });
    expect(await rows(database, "SELECT * FROM waitlist")).toHaveLength(1);
  });

  it("forget: заявки и строка частоты удалены, ответ { ok: true }", async () => {
    await send(join, telegram());
    await waitlistStore(database).join(USER, "greek-b2", 1);
    await waitlistStore(database).join(7, "greek-b1", 1);
    expect(await send({ action: "forget" })).toEqual({ status: 200, json: { ok: true } });
    expect(await rows(database, "SELECT user_id FROM waitlist")).toEqual([{ user_id: 7 }]);
    expect(await rows(database, "SELECT * FROM waitlist_users WHERE user_id = ?", USER)).toEqual([]);
  });

  it.each([
    ["курс вне списка", { action: "join", course: "greek-c9" }],
    ["без курса", { action: "join" }],
    ["курс не строкой", { action: "status", course: 1 }],
    ["неизвестное действие", { action: "drop", course: "greek-b1" }],
    ["без действия", { course: "greek-b1" }],
  ])("%s — 400, в D1 и в группе ничего", async (_, body) => {
    const bot = telegram();
    expect(await send(body, bot)).toEqual({ status: 400, json: { error: "invalid" } });
    expect(await rows(database, "SELECT * FROM waitlist")).toEqual([]);
    expect(await rows(database, "SELECT * FROM waitlist_users")).toEqual([]);
    expect(bot.calls).toEqual([]);
  });

  it.each(["not json", "null", "[]", "{}"])("тело %s — 400", async (body) => {
    expect((await waitlistRoute(request(body), env(), telegram().fetcher)).status).toBe(400);
  });

  it("подпись другим токеном — 401, в D1 и в группе ничего", async () => {
    const bot = telegram();
    const response = await waitlistRoute(
      request({ initData: signed(undefined, "999:other"), ...join }),
      env(),
      bot.fetcher,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "stale" });
    expect(await rows(database, "SELECT * FROM waitlist")).toEqual([]);
    expect(bot.calls).toEqual([]);
  });

  it("без Origin или с чужого адреса — 403", async () => {
    expect((await waitlistRoute(request({ initData: signed(), ...join }, null), env())).status).toBe(403);
    expect((await waitlistRoute(request({ initData: signed(), ...join }, "https://evil.example"), env())).status).toBe(
      403,
    );
  });

  it("хранилище недоступно — 502", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
    };
    expect(await send(join, telegram(), background(), { ...env(), FEEDBACK: broken })).toEqual({
      status: 502,
      json: { error: "failed" },
    });
  });

  it("worker.fetch ведёт /waitlist в обработчик заявки", async () => {
    const response = await worker.fetch(
      new Request("https://bot.example.workers.dev/waitlist", { method: "OPTIONS", headers: { Origin: ORIGIN } }),
      env(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("worker.fetch передаёт контекст: строка «+1» уходит через waitUntil", async () => {
    const bot = telegram();
    const ctx = background();
    const original = globalThis.fetch;
    globalThis.fetch = bot.fetcher;
    try {
      const response = await worker.fetch(request({ initData: signed(), ...join }), env(), ctx);
      expect(response.status).toBe(200);
      await ctx.settled();
    } finally {
      globalThis.fetch = original;
    }
    expect(lines(bot)).toHaveLength(1);
  });

  it("ответы /feedback и /forget — прежние байт в байт", async () => {
    const bot = telegram();
    const form = { initData: signed(), text: "Опечатка", version: "0.1.0", platform: "ios" };
    const texts = async (response: Promise<Response>) => {
      const answer = await response;
      return [answer.status, await answer.text()];
    };
    expect(await texts(feedbackForm(request(form, ORIGIN, "/feedback"), env(), bot.fetcher))).toEqual([
      200,
      '{"ok":true}',
    ]);
    expect(await texts(feedbackForm(request(form, ORIGIN, "/feedback"), env(), bot.fetcher))).toEqual([
      429,
      '{"error":"rate"}',
    ]);
    expect(await texts(feedbackForm(request({}, ORIGIN, "/feedback"), env(), bot.fetcher))).toEqual([
      400,
      '{"error":"invalid"}',
    ]);
    const forget = (initData: string) => forgetRoute(request({ initData }, ORIGIN, "/forget"), env(), bot.fetcher);
    expect(await texts(forget(signed(undefined, "999:other")))).toEqual([401, '{"error":"stale"}']);
    expect(await texts(forget(signed()))).toEqual([200, '{"ok":true}']);
  });

  it("/forget удаляет заявки, у заблокированного в users остаётся только отметка", async () => {
    const store = databaseStore(database);
    await send(join, telegram());
    await store.setThread(USER, 9);
    await store.setBlocked(USER, true);
    const response = await forgetRoute(request({ initData: signed() }, ORIGIN, "/forget"), env(), telegram().fetcher);
    expect(response.status).toBe(200);
    expect(await rows(database, "SELECT * FROM waitlist")).toEqual([]);
    expect(await rows(database, "SELECT * FROM waitlist_users")).toEqual([]);
    expect(await rows(database, "SELECT user_id, thread, blocked FROM users")).toEqual([
      { user_id: USER, thread: null, blocked: 1 },
    ]);
  });
});

describe("хранилище заявок", () => {
  it("повторный join не дублирует строку", async () => {
    const database = sqlite();
    const waitlist = waitlistStore(database);
    expect(await waitlist.join(USER, "greek-b1", 1)).toBe(true);
    expect(await waitlist.join(USER, "greek-b1", 2)).toBe(false);
    expect(await rows(database, "SELECT at FROM waitlist")).toEqual([{ at: 1 }]);
    expect(await waitlist.joined(USER, "greek-b1")).toBe(true);
    expect(await waitlist.joined(USER, "greek-b2")).toBe(false);
  });

  it("частота записи — не чаще раза в 5 с, одновременные — занят один слот", async () => {
    const waitlist = waitlistStore(sqlite());
    expect(await waitlist.claimWrite(USER, 100_000, 5000)).toBe(true);
    expect(await waitlist.claimWrite(USER, 104_999, 5000)).toBe(false);
    expect(await waitlist.claimWrite(USER, 105_000, 5000)).toBe(true);
    const both = await Promise.all([waitlist.claimWrite(7, 1, 5000), waitlist.claimWrite(7, 2, 5000)]);
    expect(both.filter(Boolean)).toHaveLength(1);
  });

  it("forget у заблокированного удаляет заявки и не трогает отметку", async () => {
    const database = sqlite();
    const waitlist = waitlistStore(database);
    await databaseStore(database).setBlocked(USER, true);
    await waitlist.join(USER, "greek-b1", 1);
    await waitlist.claimWrite(USER, 1, 5000);
    await waitlist.forget(USER);
    expect(await rows(database, "SELECT * FROM waitlist")).toEqual([]);
    expect(await rows(database, "SELECT * FROM waitlist_users")).toEqual([]);
    expect(await databaseStore(database).byUser(USER)).toMatchObject({ blocked: true });
  });

  it("scheduled удаляет заявки заблокированных автором: рассылка до них не дойдёт", async () => {
    const database = sqlite();
    const waitlist = waitlistStore(database);
    await waitlist.join(1, "greek-b1", 0);
    await waitlist.join(2, "greek-b1", 0);
    await databaseStore(database).setBlocked(1, true);
    await worker.scheduled({}, { APP_URL: "", FEEDBACK: database });
    expect(await rows(database, "SELECT user_id FROM waitlist")).toEqual([{ user_id: 2 }]);
    expect(await databaseStore(database).byUser(1)).toMatchObject({ blocked: true });
  });

  it("scheduled удаляет записи, уведомлённые больше 30 дней назад", async () => {
    const database = sqlite();
    const waitlist = waitlistStore(database);
    const now = Date.now();
    await waitlist.join(1, "greek-b1", 0);
    await waitlist.markNotified(1, "greek-b1", now - 31 * DAY);
    await waitlist.join(2, "greek-b1", 0);
    await waitlist.markNotified(2, "greek-b1", now - 29 * DAY);
    await waitlist.join(3, "greek-b1", 0);
    await waitlist.claimWrite(1, now - 31 * DAY, 5000);
    await waitlist.claimWrite(3, now - 31 * DAY, 5000);
    await waitlist.claimLine(4, now - 2 * DAY, 1);
    await waitlist.claimLine(5, now - 1000, 1);
    await worker.scheduled({}, { APP_URL: "", FEEDBACK: database });
    expect(await rows(database, "SELECT user_id FROM waitlist ORDER BY user_id")).toEqual([
      { user_id: 2 },
      { user_id: 3 },
    ]);
    expect(await rows(database, "SELECT user_id FROM waitlist_users ORDER BY user_id")).toEqual([
      { user_id: 3 },
      { user_id: 5 },
    ]);
  });
});

describe("команды заявок в общей теме", () => {
  let id = 1000;
  const general = (text: string, fields: Record<string, unknown> = {}): { message: Message } => ({
    message: { message_id: id++, chat: { id: GROUP, type: "supergroup" }, from: { id: 1 }, text, ...fields },
  });

  function setup(answer: (body: Record<string, unknown>, index: number) => Answer | Promise<Answer> = () => ok) {
    const database = sqlite();
    const sent: Record<string, unknown>[] = [];
    const deps: Deps = {
      api: async (method, body) => {
        if (method !== "sendMessage") throw new Error(method);
        sent.push(body as Record<string, unknown>);
        return answer(body as Record<string, unknown>, sent.length - 1);
      },
      store: databaseStore(database),
      waitlist: waitlistStore(database),
      waitlistCourses: ["greek-b1", "greek-b2"],
      waitlistThread: THREAD,
      supportChatId: String(GROUP),
      sentryEventUrl: "",
      appUrl: "https://tetradio.app/app/",
      now: () => NOW,
      sleep: async () => undefined,
    };
    const enroll = async (count: number, course = "greek-b1", from = 1) => {
      for (let user = from; user < from + count; user++) await deps.waitlist.join(user, course, user);
    };
    const notified = () =>
      rows(database, "SELECT user_id FROM waitlist WHERE notified_at IS NOT NULL ORDER BY user_id").then((list) =>
        list.map((row) => row.user_id),
      );
    return { database, deps, sent, enroll, notified };
  }
  const ok: Answer = { ok: true, result: { message_id: 1 } };
  const reply = (text: string) => ({ method: "sendMessage", chat_id: GROUP, text });

  it("/waitlist — по курсам «<курс>: N, не уведомлено M», в том числе пустой курс из списка", async () => {
    const { deps, enroll } = setup();
    await enroll(3);
    await deps.waitlist.markNotified(1, "greek-b1", NOW);
    await enroll(1, "english-it-b1", 10);
    expect(await handle(general("/waitlist@TetradioBot"), deps)).toEqual(
      reply("english-it-b1: 1, не уведомлено 1\ngreek-b1: 3, не уведомлено 2\ngreek-b2: 0, не уведомлено 0"),
    );
  });

  it("45 записавшихся, один 403, один заблокирован автором — «Отправлено 29, не доставлено 1, осталось 15»", async () => {
    const { deps, enroll, sent, notified } = setup((_, index) =>
      index === 4 ? { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } : ok,
    );
    await enroll(46);
    await deps.store.setBlocked(3, true);
    expect(await handle(general("/notify greek-b1 Курс B1 открыт"), deps)).toEqual(
      reply("Отправлено 29, не доставлено 1, осталось 15 — повторите команду"),
    );
    expect(sent).toHaveLength(30);
    expect(sent.every((body) => body.text === "Курс B1 открыт")).toBe(true);
    expect(sent.map((body) => body.chat_id)).not.toContain(3);
    expect(await notified()).toEqual(sent.map((body) => body.chat_id));
    expect(await handle(general("/notify greek-b1 Курс B1 открыт"), deps)).toEqual(
      reply("Отправлено 15, не доставлено 0, осталось 0 — повторите команду"),
    );
  });

  it("курс без заявок — ответ об этом, без отправки", async () => {
    const { deps, sent } = setup();
    expect(await handle(general("/notify greek-bl Курс открыт"), deps)).toEqual(
      reply("Заявок на greek-bl нет — проверьте id курса."),
    );
    expect(sent).toEqual([]);
  });

  it("хранилище не отметило получателя — рассылка остановлена, ответ с тем, что отправлено", async () => {
    const { deps, enroll, sent } = setup();
    await enroll(3);
    let marks = 0;
    const store = deps.waitlist;
    deps.waitlist = {
      ...store,
      markNotified: async (...args) => {
        if (++marks === 2) throw new Error("D1");
        return store.markNotified(...args);
      },
    };
    const answer = (await handle(general("/notify greek-b1 Курс открыт"), deps)) as unknown as { text: string };
    expect(sent).toHaveLength(2);
    expect(answer.text).toMatch(/^Рассылка остановлена: хранилище недоступно/);
  });

  it("@бот, многострочный текст — всё после id курса", async () => {
    const { deps, enroll, sent } = setup();
    await enroll(1);
    await handle(general("/notify@TetradioBot greek-b1\nКурс B1 открыт.\n\nОткройте Τετράδιο  "), deps);
    expect(sent).toEqual([{ chat_id: 1, text: "Курс B1 открыт.\n\nОткройте Τετράδιο" }]);
  });

  it.each(["Bad Request: chat not found", "Forbidden: user is deactivated"])(
    "400 «%s» отмечает запись как недоставленную",
    async (description) => {
      const { deps, enroll, notified } = setup(() => ({ ok: false, error_code: 400, description }));
      await enroll(2);
      expect(await handle(general("/notify greek-b1 Текст"), deps)).toEqual(
        reply("Отправлено 0, не доставлено 2, осталось 0 — повторите команду"),
      );
      expect(await notified()).toEqual([1, 2]);
    },
  );

  it("400 «message is too long» останавливает рассылку без отметки, ответ называет ошибку", async () => {
    const { deps, enroll, sent, notified } = setup((_, index) =>
      index === 1 ? { ok: false, error_code: 400, description: "Bad Request: message is too long" } : ok,
    );
    await enroll(5);
    expect(await handle(general("/notify greek-b1 Текст"), deps)).toEqual(
      reply(
        "Рассылка остановлена: Bad Request: message is too long\nОтправлено 1, не доставлено 0, осталось 4 — повторите команду",
      ),
    );
    expect(sent).toHaveLength(2);
    expect(await notified()).toEqual([1]);
  });

  it("429 останавливает рассылку без ожидания", async () => {
    const { deps, enroll, sent, notified } = setup(() => ({
      ok: false,
      error_code: 429,
      description: "Too Many Requests: retry after 3",
      parameters: { retry_after: 3 },
    }));
    await enroll(3);
    expect(await handle(general("/notify greek-b1 Текст"), deps)).toMatchObject({
      text: "Рассылка остановлена: Too Many Requests: retry after 3\nОтправлено 0, не доставлено 0, осталось 3 — повторите команду",
    });
    expect(sent).toHaveLength(1);
    expect(await notified()).toEqual([]);
  });

  it("Bot API недоступен — остановка без текста исключения", async () => {
    const { deps, enroll } = setup(() => {
      throw new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`);
    });
    await enroll(1);
    const answer = await handle(general("/notify greek-b1 Текст"), deps);
    expect(answer).toMatchObject({ text: expect.stringContaining("Рассылка остановлена: Bot API недоступен") });
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
  });

  it("то же обновление второй раз — ни отправки, ни ответа", async () => {
    const { deps, enroll, sent } = setup();
    await enroll(2);
    const update = general("/notify greek-b1 Текст");
    await handle(update, deps);
    expect(sent).toHaveLength(2);
    await enroll(1, "greek-b1", 3);
    expect(await handle(update, deps)).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it("текст длиннее 4096 символов — ничего не отправлено, ответ об этом; 4096 — отправлен", async () => {
    const { deps, enroll, sent } = setup();
    await enroll(1);
    expect(await handle(general(`/notify greek-b1 ${"а".repeat(4097)}`), deps)).toEqual(reply(NOTIFY_TOO_LONG));
    expect(NOTIFY_TOO_LONG).toContain("длиннее 4096 символов");
    expect(sent).toEqual([]);
    await handle(general(`/notify greek-b1 ${"а".repeat(4096)}`), deps);
    expect(sent).toHaveLength(1);
  });

  it("без текста — подсказка формата, без отправки", async () => {
    const { deps, enroll, sent } = setup();
    await enroll(1);
    expect(await handle(general("/notify greek-b1"), deps)).toEqual(reply("Формат: /notify <курс> <текст>"));
    expect(sent).toEqual([]);
  });

  it("в теме заявок команды не выполняются", async () => {
    const { deps, enroll, sent } = setup();
    await enroll(1);
    const inThread = { is_topic_message: true, message_thread_id: THREAD };
    expect(await handle(general("/notify greek-b1 Текст", inThread), deps)).toBeNull();
    expect(await handle(general("/waitlist", inThread), deps)).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe("курсы в работе и Worker", () => {
  it("каждый поставляемый курс в работе из content/courses принимает WAITLIST_COURSES", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { parse } = await import("yaml");
    const upcoming = readdirSync("content/courses")
      .map((file) => ({
        id: file.replace(/\.yaml$/, ""),
        ...(parse(readFileSync(`content/courses/${file}`, "utf8")) as object),
      }))
      .filter((course) => "upcoming" in course && !("hidden" in course))
      .map((course) => course.id);
    const listed = /"WAITLIST_COURSES":\s*"([^"]*)"/.exec(readFileSync("bot/wrangler.jsonc", "utf8"))?.[1] ?? "";
    const courses = listed.split(",").map((course) => course.trim());
    expect(upcoming.length).toBeGreaterThan(0);
    for (const id of upcoming)
      expect(
        courses.map((course) => course.trim()),
        id,
      ).toContain(id);
  });
});
