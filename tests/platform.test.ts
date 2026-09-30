// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLaunch, launchContext, resetLaunchContext, startRoute } from "../src/platform/launch";
import { telegramAdapter, webAdapter } from "../src/platform/adapter";
import { loadTelegramBridge, resetBridge } from "../src/platform/bridge";
import { applyEnvironment, platform, setPlatform } from "../src/platform/platform";
import type { TelegramWebApp } from "../src/platform/telegram-types";
import { profileFor } from "../src/storage/profile";

const initData = (user: object | null) =>
  user ? `user=${encodeURIComponent(JSON.stringify(user))}&auth_date=1&hash=abc` : "auth_date=1&hash=abc";
const location = (hash: string, search = "") => ({ hash, search });

describe("контекст запуска", () => {
  it("обычный адрес — веб даже при наличии глобального объекта Telegram", () => {
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData: "" } };
    expect(parseLaunch(location("")).kind).toBe("web");
    expect(parseLaunch(location("", "?bot=TaveloriDevBot"))).toMatchObject({ kind: "web", bot: "TaveloriDevBot" });
    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });
  it("параметры Telegram в hash дают контекст с пользователем, платформой и ботом из query", () => {
    const context = parseLaunch(
      location(
        `#tgWebAppData=${encodeURIComponent(initData({ id: 42, first_name: "Άννα", language_code: "el" }))}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`,
        "?bot=@TaveloriDevBot",
      ),
    );
    expect(context).toMatchObject({
      kind: "telegram",
      bot: "TaveloriDevBot",
      platform: "ios",
      version: "8.0",
      user: { id: 42, firstName: "Άννα", languageCode: "el" },
    });
    expect(profileFor(context).databaseName).toBe("lexi-tg-TaveloriDevBot-42");
  });
  it("без сведений о пользователе профиль анонимный и не синхронизируется; плохое имя бота заменяется основным", () => {
    const context = parseLaunch(
      location(`#tgWebAppPlatform=android&tgWebAppData=${encodeURIComponent(initData(null))}`, "?bot=bad name!"),
    );
    expect(context).toMatchObject({ kind: "telegram", user: null, bot: "TaveloriBot" });
    expect(profileFor(context)).toMatchObject({ syncable: false, databaseName: "lexi-tg-TaveloriBot-anonymous" });
  });
  it("контекст запоминается на время вкладки, даже если маршрутизация убрала hash", () => {
    resetLaunchContext();
    sessionStorage.clear();
    window.location.hash = `#tgWebAppPlatform=ios&tgWebAppData=${encodeURIComponent(initData({ id: 7, first_name: "A" }))}`;
    expect(launchContext().kind).toBe("telegram");
    resetLaunchContext();
    window.location.hash = "";
    expect(launchContext()).toMatchObject({ kind: "telegram", user: { id: 7 } });
    sessionStorage.clear();
    resetLaunchContext();
    expect(launchContext().kind).toBe("web");
  });
});

/** Эмуляция bridge: считаем вызовы, чтобы проверить симметрию подписок. */
function fakeApp(over: Partial<TelegramWebApp> = {}) {
  const calls: string[] = [];
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const button = (name: string) => ({
    isVisible: false,
    show() {
      calls.push(`${name}.show`);
    },
    hide() {
      calls.push(`${name}.hide`);
    },
    onClick(handler: () => void) {
      calls.push(`${name}.onClick`);
      handlers.set(name, (handlers.get(name) ?? new Set()).add(handler));
    },
    offClick(handler: () => void) {
      calls.push(`${name}.offClick`);
      handlers.get(name)?.delete(handler);
    },
  });
  const app = {
    initData: "",
    initDataUnsafe: {},
    version: "8.0",
    platform: "ios",
    colorScheme: "light",
    themeParams: { bg_color: "#ffffff", text_color: "#000000" },
    isExpanded: false,
    viewportHeight: 700,
    viewportStableHeight: 700,
    isActive: true,
    isVersionAtLeast: (version: string) => Number(version) <= 8,
    ready() {
      calls.push("ready");
    },
    expand() {
      calls.push("expand");
      (app as { isExpanded: boolean }).isExpanded = true;
    },
    close() {},
    onEvent(event: string, handler: (...args: unknown[]) => void) {
      calls.push(`on:${event}`);
      handlers.set(event, (handlers.get(event) ?? new Set()).add(handler));
    },
    offEvent(event: string, handler: (...args: unknown[]) => void) {
      calls.push(`off:${event}`);
      handlers.get(event)?.delete(handler);
    },
    BackButton: button("back"),
    MainButton: {
      ...button("main"),
      text: "",
      isActive: true,
      isProgressVisible: false,
      setText() {},
      enable() {},
      disable() {},
      showProgress() {
        calls.push("main.progress");
      },
      hideProgress() {
        calls.push("main.noprogress");
      },
      setParams(params: object) {
        calls.push(`main.setParams:${JSON.stringify(params)}`);
      },
    },
    HapticFeedback: {
      impactOccurred() {},
      notificationOccurred(type: string) {
        calls.push(`haptic:${type}`);
      },
      selectionChanged() {},
    },
    ...over,
  } as unknown as TelegramWebApp;
  const fire = (event: string, ...args: unknown[]) => handlers.get(event)?.forEach((handler) => handler(...args));
  return { app, calls, fire, handlers };
}

describe("платформенный адаптер Telegram", () => {
  it("веб-адаптер ничего не вызывает и не вибрирует", () => {
    const web = webAdapter();
    expect(web.capabilities).toMatchObject({ back: false, haptics: false, primaryAction: false, cloudStorage: false });
    expect(() => {
      web.haptic("success");
      web.back(() => undefined)();
      web.primaryAction({ text: "x", onClick() {} });
      web.clearPrimaryAction();
    }).not.toThrow();
  });
  it("возможности проверяются по отдельности: частично доступный API не ломает остальное", () => {
    const { app } = fakeApp({ BackButton: undefined, HapticFeedback: undefined } as never);
    const adapter = telegramAdapter(app);
    expect(adapter.capabilities).toMatchObject({
      back: false,
      haptics: false,
      primaryAction: true,
      theme: true,
      cloudStorage: false,
    });
    expect(() => adapter.haptic("error")).not.toThrow();
    expect(adapter.back(() => undefined)).toBeTypeOf("function");
    const old = fakeApp({ isVersionAtLeast: () => false } as never);
    expect(telegramAdapter(old.app).capabilities.back).toBe(false);
  });
  it("подключение и освобождение симметричны: повтор в StrictMode не удваивает обработчики", () => {
    const { app, calls, handlers } = fakeApp();
    const first = telegramAdapter(app);
    first.dispose();
    const second = telegramAdapter(app);
    expect(handlers.get("back")?.size).toBe(1);
    expect(handlers.get("main")?.size).toBe(1);
    expect(handlers.get("themeChanged")?.size).toBe(1);
    expect(handlers.get("activated")?.size).toBe(1);
    expect(handlers.get("deactivated")?.size).toBe(1);
    second.dispose();
    expect(handlers.get("back")?.size).toBe(0);
    expect(handlers.get("themeChanged")?.size).toBe(0);
    expect(handlers.get("activated")?.size).toBe(0);
    expect(handlers.get("deactivated")?.size).toBe(0);
    expect(calls.filter((call) => call === "back.onClick")).toHaveLength(2);
    expect(calls.filter((call) => call === "back.offClick")).toHaveLength(2);
  });
  it("возврат: активен обработчик экрана поверх резервного, после снятия остаётся резервный, без обработчиков кнопка скрыта", () => {
    const { app, calls, fire } = fakeApp();
    const adapter = telegramAdapter(app);
    const log: string[] = [];
    const offFallback = adapter.back(() => log.push("fallback"), 0);
    const offScreen = adapter.back(() => log.push("screen"), 1);
    fire("back");
    expect(calls.filter((call) => call === "back.show").length).toBeGreaterThan(0);
    offScreen();
    fire("back");
    expect(log).toEqual(["screen", "fallback"]);
    // Снятие того же обработчика дважды безвредно.
    offScreen();
    offFallback();
    expect(calls[calls.length - 1]).toBe("back.hide");
    // Кнопка Telegram и внутренняя ведут в один обработчик: обработчик зарегистрирован один раз, вызов один.
    fire("back");
    expect(log).toHaveLength(2);
  });
  it("нативное главное действие: текст, loading/disabled, замена обработчика и снятие", () => {
    const { app, calls, fire } = fakeApp();
    const adapter = telegramAdapter(app);
    const log: string[] = [];
    adapter.primaryAction({ text: "Начать занятие", onClick: () => log.push("start") });
    fire("main");
    adapter.primaryAction({ text: "Продолжить занятие", onClick: () => log.push("continue"), loading: true });
    fire("main"); // в состоянии загрузки клик игнорируется
    adapter.primaryAction({ text: "Продолжить занятие", onClick: () => log.push("continue"), disabled: true });
    fire("main");
    adapter.primaryAction({ text: "Продолжить занятие", onClick: () => log.push("continue") });
    fire("main");
    expect(log).toEqual(["start", "continue"]);
    expect(calls).toContain('main.setParams:{"text":"Начать занятие","is_active":true,"is_visible":true}');
    expect(calls).toContain("main.progress");
    adapter.clearPrimaryAction();
    fire("main");
    expect(log).toHaveLength(2);
    expect(calls[calls.length - 1]).toBe("main.hide");
  });
  it("отклик уходит только при поддержке; исключение API не всплывает", () => {
    const { app, calls } = fakeApp();
    const adapter = telegramAdapter(app);
    adapter.haptic("warning");
    expect(calls).toContain("haptic:warning");
    const broken = fakeApp({
      HapticFeedback: {
        notificationOccurred() {
          throw new Error("boom");
        },
        impactOccurred() {},
        selectionChanged() {},
      },
    } as never);
    expect(() => telegramAdapter(broken.app).haptic("success")).not.toThrow();
  });
  it("тема и размеры: viewport реагирует только на устойчивые изменения, недоступные отступы дают нули", () => {
    const { app, fire } = fakeApp();
    const adapter = telegramAdapter(app);
    const seen: string[] = [];
    adapter.onViewportChange(() => seen.push("viewport"));
    adapter.onThemeChange(() => seen.push("theme"));
    fire("viewportChanged", { isStateStable: false });
    fire("viewportChanged", { isStateStable: true });
    fire("themeChanged");
    expect(seen).toEqual(["viewport", "theme"]);
    expect(adapter.viewport()).toEqual({
      stableHeight: 700,
      safeArea: { top: 0, bottom: 0 },
      contentSafeArea: { top: 0, bottom: 0 },
      mode: "compact",
    });
    expect(adapter.theme()).toEqual({ scheme: "light", params: { bg_color: "#ffffff", text_color: "#000000" } });
    adapter.ready();
    expect(app.isExpanded).toBe(true);
  });
  it("активность: сворачивание и возврат доходят до слушателей, isActive читается, клиент без этих событий не ломает адаптер", () => {
    const { app, fire } = fakeApp();
    const adapter = telegramAdapter(app);
    const seen: boolean[] = [];
    const off = adapter.onActiveChange((active) => seen.push(active));
    expect(adapter.active()).toBe(true);
    (app as { isActive: boolean }).isActive = false;
    fire("deactivated");
    expect(adapter.active()).toBe(false);
    (app as { isActive: boolean }).isActive = true;
    fire("activated");
    expect(seen).toEqual([false, true]);
    off();
    fire("deactivated");
    expect(seen).toHaveLength(2);
    const legacy = fakeApp({ isActive: undefined, version: "6.0" } as never);
    legacy.app.onEvent = (event, handler) => {
      if (event === "activated" || event === "deactivated") throw new Error("Unknown event");
      legacy.handlers.set(event, (legacy.handlers.get(event) ?? new Set()).add(handler));
    };
    const old = telegramAdapter(legacy.app);
    expect(old.active()).toBe(true);
    expect(legacy.handlers.get("themeChanged")?.size).toBe(1);
    expect(webAdapter().active()).toBe(true);
  });
});

describe("переменные оболочки", () => {
  afterEach(() => {
    setPlatform(webAdapter());
  });
  it("высота держит последнее положительное значение при нулевом viewport, активность видна в атрибуте", () => {
    const root = document.documentElement;
    const { app, fire } = fakeApp();
    setPlatform(telegramAdapter(app), app);
    expect(platform().kind).toBe("telegram");
    expect(root.style.getPropertyValue("--app-height")).toBe("700px");
    expect(root.dataset.appActive).toBe("true");
    (app as { viewportStableHeight: number }).viewportStableHeight = 0;
    (app as { isActive: boolean }).isActive = false;
    applyEnvironment();
    expect(root.style.getPropertyValue("--app-height")).toBe("700px");
    expect(root.dataset.appActive).toBe("false");
    (app as { viewportStableHeight: number }).viewportStableHeight = 640;
    (app as { isActive: boolean }).isActive = true;
    applyEnvironment();
    expect(root.style.getPropertyValue("--app-height")).toBe("640px");
    expect(root.dataset.appActive).toBe("true");
    fire("activated"); // событие без слушателей окружения безвредно
    setPlatform(webAdapter());
    expect(root.style.getPropertyValue("--app-height")).toBe("");
    expect(root.dataset.appActive).toBeUndefined();
    const zero = fakeApp({ viewportStableHeight: 0 } as never);
    setPlatform(telegramAdapter(zero.app), zero.app);
    expect(root.style.getPropertyValue("--app-height")).toBe("");
  });
});

describe("загрузка bridge", () => {
  afterEach(() => {
    resetBridge();
    delete (window as unknown as { Telegram?: unknown }).Telegram;
    vi.useRealTimers();
  });
  it("существующий объект используется без сетевой загрузки", async () => {
    const { app } = fakeApp();
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: app };
    expect(await loadTelegramBridge(10)).toBe(app);
    expect(document.querySelector('script[src*="telegram-web-app"]')).toBeNull();
  });
  it("ошибка загрузки и тайм-аут оставляют браузерный режим", async () => {
    const failing = document.implementation.createHTMLDocument();
    const original = failing.createElement.bind(failing);
    failing.createElement = ((tag: string) => {
      const element = original(tag);
      if (tag === "script") setTimeout(() => element.onerror?.(new Event("error")), 0);
      return element;
    }) as typeof failing.createElement;
    expect(await loadTelegramBridge(1000, failing)).toBeNull();
    resetBridge();
    const silent = document.implementation.createHTMLDocument();
    expect(await loadTelegramBridge(20, silent)).toBeNull();
  });
});

describe("крошки жизненного цикла для отчётов о сбоях", () => {
  it("activated, deactivated и viewportChanged пишут имя события и размеры, но не initData и не пользователя", async () => {
    const { pendingCrumbs, resetReporting } = await import("../src/reporting/reporting");
    resetReporting({ dsn: "https://key@o1.ingest.sentry.io/1", loader: () => Promise.reject(new Error("не в тесте")) });
    const { app, fire } = fakeApp({
      initData: "user=%7B%22id%22%3A42%2C%22first_name%22%3A%22%D0%90%D0%BD%D0%BD%D0%B0%22%7D&hash=abc",
      initDataUnsafe: { user: { id: 42, first_name: "Анна", username: "anna" } },
    } as never);
    const adapter = telegramAdapter(app);
    fire("deactivated");
    (app as { viewportStableHeight: number }).viewportStableHeight = 0;
    fire("viewportChanged", { isStateStable: false }); // неустойчивое состояние крошки не даёт
    fire("viewportChanged", { isStateStable: true });
    (app as { viewportStableHeight: number }).viewportStableHeight = 640;
    fire("activated");
    const crumbs = pendingCrumbs();
    expect(crumbs.map((crumb) => crumb.message)).toEqual(["deactivated", "viewportChanged", "activated"]);
    expect(crumbs[1].data).toEqual({ height: 700, stableHeight: 0, expanded: false, fullscreen: false });
    expect(crumbs[2].data).toMatchObject({ stableHeight: 640 });
    const text = JSON.stringify(crumbs);
    for (const secret of ["initData", "42", "Анна", "anna", "hash", "user"]) expect(text).not.toContain(secret);
    adapter.dispose();
    resetReporting();
  });
});

describe("контекст запуска между переходами и перезагрузками", () => {
  const tgHash = (user = { id: 7, first_name: "A" }, extra = "") =>
    `#tgWebAppPlatform=ios&tgWebAppData=${encodeURIComponent(`${initData(user)}${extra}`)}`;
  /** Страница с новым адресом: перезагрузка сбрасывает запомненный контекст, sessionStorage вкладки остаётся. */
  const open = (hash: string, search = "") => {
    window.history.replaceState(null, "", `/${search}${hash}`);
    resetLaunchContext();
    return launchContext();
  };
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    resetLaunchContext();
  });

  it("перезагрузка Telegram без hash и ?bot= сохраняет вид, пользователя, launchId и профиль, запись не заменяется веб-контекстом", () => {
    const first = open(tgHash(undefined, "&query_id=AAH1"));
    const stored = sessionStorage.getItem("lexi:launch");
    const again = open("");
    expect(again).toMatchObject({ kind: "telegram", user: { id: 7 }, launchId: "AAH1", bot: "TaveloriBot" });
    expect(profileFor(again).databaseName).toBe(profileFor(first).databaseName);
    expect(sessionStorage.getItem("lexi:launch")).toBe(stored);
  });
  it("Telegram с ?bot=TaveloriDevBot после перезагрузки без параметра сохраняет dev-бота и базу профиля", () => {
    open(tgHash(), "?bot=TaveloriDevBot");
    const again = open("");
    expect(again.bot).toBe("TaveloriDevBot");
    expect(profileFor(again).databaseName).toBe("lexi-tg-TaveloriDevBot-7");
  });
  it("веб с ?bot= сохраняет бота, когда адрес потерял параметр", () => {
    expect(open("", "?bot=TaveloriDevBot")).toMatchObject({ kind: "web", bot: "TaveloriDevBot" });
    expect(open("")).toMatchObject({ kind: "web", bot: "TaveloriDevBot" });
    expect(JSON.parse(sessionStorage.getItem("lexi:launch")!)).toEqual({ kind: "web", bot: "TaveloriDevBot" });
  });
  it("явный ?bot= в новом адресе заменяет сохранённый", () => {
    open(tgHash(), "?bot=TaveloriDevBot");
    expect(open("", "?bot=OtherTestBot").bot).toBe("OtherTestBot");
    expect(open("").bot).toBe("OtherTestBot");
  });
  it("новый Telegram-запуск заменяет прежнюю Telegram-запись", () => {
    open(tgHash({ id: 7, first_name: "A" }, "&query_id=one"));
    const next = open(tgHash({ id: 8, first_name: "B" }, "&query_id=two"));
    expect(next).toMatchObject({ user: { id: 8 }, launchId: "two" });
    expect(open("")).toMatchObject({ user: { id: 8 }, launchId: "two" });
  });
  it("launchId — query_id; без него null даже при подписи hash, вне Telegram null", () => {
    expect(parseLaunch(location(tgHash(undefined, "&query_id=AAH1"))).launchId).toBe("AAH1");
    expect(parseLaunch(location(tgHash())).launchId).toBeNull();
    expect(parseLaunch(location("")).launchId).toBeNull();
  });
});

describe("путь по параметру запуска", () => {
  const tg = (startParam: string | null) => ({
    ...parseLaunch(location(`#tgWebAppPlatform=ios&tgWebAppData=${encodeURIComponent(initData(null))}`)),
    startParam,
  });
  it("w_<id> ведёт к слову, остальное — никуда", () => {
    expect(startRoute(tg("w_w34-03"))).toBe("/share/word/w34-03");
    expect(startRoute(tg("promo"))).toBeNull();
    expect(startRoute(tg("w_"))).toBeNull();
    expect(startRoute(tg("w_a/b"))).toBeNull();
    expect(startRoute(tg(`w_${"a".repeat(61)}`))).toBeNull();
    expect(startRoute(tg(`w_${"a".repeat(60)}`))).toBe(`/share/word/${"a".repeat(60)}`);
    expect(startRoute({ ...parseLaunch(location("")), startParam: "w_w34-03" })).toBeNull();
  });
});
