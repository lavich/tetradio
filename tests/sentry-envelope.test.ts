// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input instanceof Request ? input.url : input).includes("ingest"))
      sent.push(typeof init?.body === "string" ? init.body : new TextDecoder().decode(init?.body as Uint8Array));
    return new Response("{}", { status: 200 });
  }),
);

const ALLOWED_PATHS = new Set([
  "breadcrumbs[].category",
  "breadcrumbs[].data.from",
  "breadcrumbs[].data.method",
  "breadcrumbs[].data.status_code",
  "breadcrumbs[].data.to",
  "breadcrumbs[].data.url",
  "breadcrumbs[].timestamp",
  "breadcrumbs[].type",
  "contexts.culture.calendar",
  "contexts.culture.locale",
  "contexts.culture.timezone",
  "contexts.react.version",
  "contexts.trace.span_id",
  "contexts.trace.trace_id",
  "environment",
  "event_id",
  "exception.values[].mechanism.handled",
  "exception.values[].mechanism.synthetic",
  "exception.values[].mechanism.type",
  "exception.values[].stacktrace.frames[].colno",
  "exception.values[].stacktrace.frames[].filename",
  "exception.values[].stacktrace.frames[].function",
  "exception.values[].stacktrace.frames[].in_app",
  "exception.values[].stacktrace.frames[].lineno",
  "exception.values[].type",
  "exception.values[].value",
  "extra.category",
  "extra.kind",
  "level",
  "message",
  "platform",
  "release",
  "request.url",
  "sdk.integrations[]",
  "sdk.name",
  "sdk.packages[].name",
  "sdk.packages[].version",
  "sdk.settings.infer_ip",
  "sdk.version",
  "tags.app.version",
  "tags.env",
  "tags.report.category",
  "timestamp",
]);

function paths(value: unknown, path = "", out = new Set<string>()) {
  if (Array.isArray(value)) value.forEach((inner) => paths(inner, `${path}[]`, out));
  else if (value && typeof value === "object")
    for (const [key, inner] of Object.entries(value)) paths(inner, path ? `${path}.${key}` : key, out);
  else out.add(path);
  return out;
}

type Item = { type?: string; [key: string]: unknown };
const items = () =>
  sent.flatMap((body) =>
    body
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Item),
  );
const events = () => items().filter((item) => item.event_id && item.exception) as Record<string, any>[];

describe("конверт Sentry", () => {
  beforeAll(async () => {
    const sentry = await import("../src/reporting/sentry");
    sentry.init({
      dsn: "https://key@o1.ingest.sentry.io/1",
      release: "r1",
      tags: { env: "browser", "app.version": "1" },
    });
    document.cookie = "session=secret";
    await fetch("/content/catalog.json?initData=secret");
    await fetch("https://other.example/path?x=1");
    history.pushState({}, "", "/app/course?bot=secret");
    console.log("секрет в консоли");
    sentry.capture(new Error("boom tetradio-tg-bot-123"), {
      id: "0123456789abcdef0123456789abcdef",
      category: "storage",
      extra: { kind: "k", secret: "s" },
      mechanism: "explicit",
    });
    sentry.capture("строка, не Error", { id: "fedcba9876543210fedcba9876543210", mechanism: "explicit" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await sentry.close();
  });
  afterAll(() => vi.unstubAllGlobals());

  it("уходят только события, без сессий и прочих конвертов", () => {
    expect(items().flatMap((item) => (item.type ? [item.type] : []))).toEqual(["event", "event"]);
  });

  it("событие несёт только разрешённые поля", () => {
    const extra = events().flatMap((event) => [...paths(event)].filter((path) => !ALLOWED_PATHS.has(path)));
    expect(extra).toEqual([]);
  });

  it("без консоли, cookie, параметров адреса, чужих запросов и имени базы", () => {
    const text = JSON.stringify(events());
    for (const secret of [
      "секрет в консоли",
      "session=secret",
      "initData",
      "bot=secret",
      "other.example",
      "bot-123",
      '"s"',
    ])
      expect(text).not.toContain(secret);
  });

  it("у ошибки не типа Error нет синтетического стека", () => {
    const string = events().find((event) => event.message === "строка, не Error")!;
    expect(string.exception.values[0].stacktrace).toBeUndefined();
  });
});
