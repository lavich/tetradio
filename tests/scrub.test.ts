import { describe, expect, it } from "vitest";
import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import { filterBreadcrumb, scrubEvent, scrubUrl } from "../src/reporting/scrub";

const ORIGIN = "https://lavich.github.io";
const event = (over: Partial<ErrorEvent> = {}): ErrorEvent => ({ type: undefined, event_id: "e1", ...over });

describe("очистка адресов", () => {
  it("режет параметры запроса и фрагмент, оставляя путь", () => {
    expect(scrubUrl("https://lavich.github.io/words/w038?from=today#tgWebAppData=user%3D1", ORIGIN)).toBe(
      "/words/w038",
    );
    expect(scrubUrl("/session?x=1", ORIGIN)).toBe("/session");
    expect(scrubUrl("https://other.example/a/b?q=1", ORIGIN)).toBe("https://other.example/a/b");
    expect(scrubUrl("http://", ORIGIN)).toBe("http://"); // неразборный адрес остаётся как есть
  });
});

describe("очистка события", () => {
  it("удаляет поле пользователя, режет адрес запроса и убирает его заголовки, куки и данные", () => {
    const out = scrubEvent(
      event({
        user: { id: "42", username: "anna", ip_address: "{{auto}}" },
        request: {
          url: "https://lavich.github.io/more?bot=X#tgWebAppData=abc",
          headers: { Cookie: "a=b" },
          cookies: { a: "b" },
          data: "body",
          query_string: "bot=X",
        },
      }),
      ORIGIN,
    );
    expect(out.user).toBeUndefined();
    expect(out.request).toEqual({ url: "/more" });
  });
  it("пропускает дополнительные поля только из разрешённого списка", () => {
    const out = scrubEvent(
      event({
        extra: {
          category: "content",
          kind: "schema",
          packageId: "mech-1",
          packageVersion: "3",
          componentStack: "\n    at SessionScreen\n    at Recovery",
          words: [{ greek: "σπίτι" }],
          answer: "дом",
          userId: 42,
        },
      }),
      ORIGIN,
    );
    expect(out.extra).toEqual({
      category: "content",
      kind: "schema",
      packageId: "mech-1",
      packageVersion: "3",
      componentStack: "\n    at SessionScreen\n    at Recovery",
    });
  });
  it("прогоняет крошки события через фильтр и режет адреса в них", () => {
    const out = scrubEvent(
      event({
        breadcrumbs: [
          { category: "console", message: "σπίτι — дом", level: "warning" },
          { category: "navigation", data: { from: "/?x=1", to: "/words/w038#frag" } },
          { category: "ui.click", message: "button.answer" },
        ],
      }),
      ORIGIN,
    );
    expect(out.breadcrumbs).toEqual([{ category: "navigation", data: { from: "/", to: "/words/w038" } }]);
  });
  it("скрывает имя базы владельца — бот и Telegram ID — во всех текстах события", () => {
    const name = "tetradio-tg-tetradio_bot-123456789";
    const out = scrubEvent(
      event({
        message: `Database ${name} is closed`,
        logentry: { message: `open ${name}`, params: [name] },
        exception: {
          values: [
            { type: "DatabaseClosedError", value: `Database ${name} has been closed` },
            { type: "UnknownError", value: `Unable to open ${name}`, mechanism: { type: "chained", data: { name } } },
          ],
        },
        breadcrumbs: [
          { category: "tetradio.lifecycle", message: `reopen ${name}`, data: { lock: `tetradio-sync-${name}` } },
        ],
        extra: { componentStack: `at Db(${name})` },
        contexts: { storage: { database: name } },
        tags: { lock: `tetradio-sync-${name}` },
      }),
      ORIGIN,
    );
    const text = JSON.stringify(out);
    expect(text).not.toContain("123456789");
    expect(text).not.toContain("tetradio_bot");
    expect(out.exception?.values?.[0].value).toBe("Database tetradio-tg-… has been closed");
    expect(out.exception?.values?.[0].type).toBe("DatabaseClosedError");
  });

  it("убирает данные запуска Telegram из текстов ошибок", () => {
    const out = scrubEvent(
      event({
        exception: {
          values: [
            {
              type: "Error",
              value: "Rejected: https://x/app/#tgWebAppData=user%3D%7B%22id%22%3A123456789%7D&tgWebAppVersion=8.0",
            },
          ],
        },
      }),
      ORIGIN,
    );
    expect(out.exception?.values?.[0].value).toBe("Rejected: https://x/app/#tgWebAppData=…&tgWebAppVersion=…");
  });
  it("режет параметры и фрагмент в адресах кадров, оставляя адрес скрипта целым", () => {
    const frames = [
      { filename: "https://tetradio.app/app/?bot=x#tgWebAppData=user%3D%7B%22id%22%3A42%7D", lineno: 0 },
      { filename: "https://tetradio.app/assets/app-abc.js", lineno: 1 },
      { filename: "<anonymous>" },
    ];
    const out = scrubEvent(event({ exception: { values: [{ type: "Error", stacktrace: { frames } }] } }), ORIGIN);
    expect(out.exception!.values![0]!.stacktrace!.frames!.map((frame) => frame.filename)).toEqual([
      "https://tetradio.app/app/",
      "https://tetradio.app/assets/app-abc.js",
      "<anonymous>",
    ]);
  });

  it("не трогает метки и не падает на пустом событии", () => {
    const out = scrubEvent(event({ tags: { env: "telegram", "tg.version": "8.0" } }), ORIGIN);
    expect(out.tags).toEqual({ env: "telegram", "tg.version": "8.0" });
    expect(out.extra).toBeUndefined();
  });
});

describe("фильтр хлебных крошек", () => {
  const crumb = (over: Breadcrumb): Breadcrumb => ({ timestamp: 1, ...over });
  it("отбрасывает консоль и клики по DOM", () => {
    expect(filterBreadcrumb(crumb({ category: "console", message: "x" }), ORIGIN)).toBeNull();
    expect(filterBreadcrumb(crumb({ category: "ui.click", message: "button" }), ORIGIN)).toBeNull();
    expect(filterBreadcrumb(crumb({ category: "ui.input", message: "input" }), ORIGIN)).toBeNull();
    expect(filterBreadcrumb(crumb({ category: "sentry.event", message: "x" }), ORIGIN)).toBeNull();
    expect(filterBreadcrumb(crumb({ message: "без категории" }), ORIGIN)).toBeNull();
  });
  it("оставляет навигацию только с путями", () => {
    expect(
      filterBreadcrumb(
        crumb({ category: "navigation", data: { from: "/more?bot=Dev", to: "/more/settings#a" } }),
        ORIGIN,
      ),
    ).toEqual({ timestamp: 1, category: "navigation", data: { from: "/more", to: "/more/settings" } });
  });
  it("оставляет запросы к собственному контенту без тел и с адресом до пути; чужие запросы отбрасывает", () => {
    expect(
      filterBreadcrumb(
        crumb({
          category: "fetch",
          type: "http",
          data: {
            url: "https://lavich.github.io/content/catalog.json?v=2",
            method: "GET",
            status_code: 200,
            request_body_size: 0,
            response_body_size: 1234,
          },
        }),
        ORIGIN,
      ),
    ).toEqual({
      timestamp: 1,
      category: "fetch",
      type: "http",
      data: { url: "/content/catalog.json", method: "GET", status_code: 200 },
    });
    expect(
      filterBreadcrumb(
        crumb({
          category: "xhr",
          type: "http",
          data: { url: "/content/mech-1.json", method: "GET", status_code: 404 },
        }),
        ORIGIN,
      ),
    ).toEqual({
      timestamp: 1,
      category: "xhr",
      type: "http",
      data: { url: "/content/mech-1.json", method: "GET", status_code: 404 },
    });
    expect(
      filterBreadcrumb(
        crumb({
          category: "fetch",
          type: "http",
          data: { url: "https://o1.ingest.sentry.io/api/1/envelope/", method: "POST" },
        }),
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      filterBreadcrumb(
        crumb({
          category: "fetch",
          type: "http",
          data: { url: "https://telegram.org/js/telegram-web-app.js", method: "GET" },
        }),
        ORIGIN,
      ),
    ).toBeNull();
  });
  it("оставляет крошки жизненного цикла Mini App как есть", () => {
    const lifecycle = crumb({
      category: "tetradio.lifecycle",
      message: "viewportChanged",
      data: { stableHeight: 640, height: 640, visible: true },
    });
    expect(filterBreadcrumb(lifecycle, ORIGIN)).toEqual(lifecycle);
  });
});
