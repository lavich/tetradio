import { describe, expect, it } from "vitest";
import { webhook } from "../scripts/bot-webhook";

const TOKEN = "123456:SECRET-token_value";
const env = {
  BOT_TOKEN: TOKEN,
  WEBHOOK_URL: "https://tetradio-bot.example.workers.dev/",
  WEBHOOK_SECRET: "a".repeat(64),
};
const INFO = { ok: true, result: { url: env.WEBHOOK_URL, pending_update_count: 0 } };

function telegram(answers: Record<string, unknown>) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const request = async (url: string, init?: { body?: string }) => {
    const method = url.split("/").pop()!;
    calls.push({ method, body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> });
    const answer = answers[method];
    if (answer instanceof Error) throw answer;
    return Response.json(answer ?? { ok: true, result: true });
  };
  return { calls, request: request as typeof fetch };
}
const printed = (result: { out: string[]; err: string[] }) => [...result.out, ...result.err].join("\n");

describe("регистрация вебхука", () => {
  it("setWebhook с секретом, только сообщениями и сбросом очереди, затем getWebhookInfo", async () => {
    const api = telegram({ getWebhookInfo: INFO });
    const result = await webhook([], env, api.request);
    expect(result.code).toBe(0);
    expect(api.calls.map((call) => call.method)).toEqual(["setWebhook", "getWebhookInfo"]);
    expect(api.calls[0].body).toEqual({
      url: env.WEBHOOK_URL,
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
    expect(printed(result)).toContain(env.WEBHOOK_URL);
    expect(printed(result)).not.toContain(TOKEN);
  });

  it("--delete снимает вебхук без адреса и секрета", async () => {
    const api = telegram({ getWebhookInfo: { ok: true, result: { url: "", pending_update_count: 0 } } });
    const result = await webhook(["--delete"], { BOT_TOKEN: TOKEN }, api.request);
    expect(result.code).toBe(0);
    expect(api.calls.map((call) => call.method)).toEqual(["deleteWebhook", "getWebhookInfo"]);
  });

  it("последняя ошибка доставки печатается", async () => {
    const info = {
      ok: true,
      result: { ...INFO.result, pending_update_count: 3, last_error_message: "Wrong response" },
    };
    const result = await webhook([], env, telegram({ getWebhookInfo: info }).request);
    expect(printed(result)).toContain("Wrong response");
    expect(printed(result)).toContain("Ожидают доставки: 3");
  });

  it("ответ ok: false — код 1, описание Telegram, без токена", async () => {
    const refused = { ok: false, error_code: 400, description: `Bad Request: bot${TOKEN} rejected` };
    const result = await webhook([], env, telegram({ setWebhook: refused }).request);
    expect(result.code).toBe(1);
    expect(printed(result)).toContain("Bad Request");
    expect(printed(result)).not.toContain(TOKEN);
  });

  it("HTML-ответ 502 — код 1, статус, без токена", async () => {
    const request = (async () => new Response(`<html>bot${TOKEN}</html>`, { status: 502 })) as unknown as typeof fetch;
    const result = await webhook([], env, request);
    expect(result.code).toBe(1);
    expect(printed(result)).toContain("HTTP 502");
    expect(printed(result)).not.toContain(TOKEN);
  });

  it("причина сбоя сети печатается без токена", async () => {
    const failure = new TypeError("fetch failed", { cause: new Error(`getaddrinfo ENOTFOUND bot${TOKEN}`) });
    const result = await webhook([], env, telegram({ setWebhook: failure }).request);
    expect(result.code).toBe(1);
    expect(printed(result)).toContain("ENOTFOUND");
    expect(printed(result)).not.toContain(TOKEN);
  });

  it("неизвестный аргумент — код 1 и ни одного запроса", async () => {
    const api = telegram({});
    const result = await webhook(["--delte"], env, api.request);
    expect(result.code).toBe(1);
    expect(api.calls).toEqual([]);
  });

  it("сбой сети — код 1, без токена", async () => {
    const failure = new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/setWebhook`);
    const result = await webhook([], env, telegram({ setWebhook: failure }).request);
    expect(result.code).toBe(1);
    expect(printed(result)).not.toContain(TOKEN);
  });

  it.each([
    ["без токена", { ...env, BOT_TOKEN: "" }],
    ["без адреса", { ...env, WEBHOOK_URL: undefined }],
    ["без секрета", { ...env, WEBHOOK_SECRET: undefined }],
    ["секрет base64", { ...env, WEBHOOK_SECRET: "abc+/=" }],
    ["секрет длиннее 256", { ...env, WEBHOOK_SECRET: "a".repeat(257) }],
  ])("%s — код 1 и ни одного запроса", async (_, broken) => {
    const api = telegram({});
    const result = await webhook([], broken, api.request);
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).not.toBe("");
    expect(api.calls).toEqual([]);
  });
});
