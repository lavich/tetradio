// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tgHash = (startParam: string, queryId?: string) =>
  `#tgWebAppPlatform=ios&tgWebAppData=${encodeURIComponent(
    `user=${encodeURIComponent(JSON.stringify({ id: 7, first_name: "A" }))}&auth_date=1&hash=abc&start_param=${startParam}${queryId ? `&query_id=${queryId}` : ""}`,
  )}`;

/** Загрузка страницы: модули читаются заново, sessionStorage вкладки остаётся прежним. */
async function page(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
  vi.resetModules();
  const [{ act, createElement }, { createRoot }, router, navigation] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("react-router-dom"),
    import("../src/app/navigation"),
  ]);
  /** Монтаж приложения в этой странице; возвращает путь после эффектов. */
  return async () => {
    let path = "";
    const Probe = () => {
      navigation.useStartRoute();
      path = router.useLocation().pathname;
      return null;
    };
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(router.MemoryRouter, null, createElement(Probe)));
    });
    act(() => root.unmount());
    host.remove();
    return path;
  };
}

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("переход по параметру запуска", () => {
  it("с launchId: первый монтаж переходит, повторный и перезагрузка того же запуска — нет", async () => {
    const mount = await page(tgHash("w_w34-03", "Q1"));
    expect(await mount()).toBe("/share/word/w34-03");
    expect(await mount()).toBe("/");
    expect(sessionStorage.getItem("lexi:start-consumed")).toBe("Q1");
    const reload = await page("");
    expect(await reload()).toBe("/");
  });
  it("новый launchId при старой метке переходит — и с другим, и с тем же параметром", async () => {
    await (
      await page(tgHash("w_w34-03", "Q1"))
    )();
    expect(await (await page(tgHash("w_w12-01", "Q2")))()).toBe("/share/word/w12-01");
    expect(await (await page(tgHash("w_w12-01", "Q3")))()).toBe("/share/word/w12-01");
  });
  it("без launchId: повторный монтаж в странице не переходит, перезагрузка переходит, метки нет", async () => {
    const mount = await page(tgHash("w_w34-03"));
    expect(await mount()).toBe("/share/word/w34-03");
    expect(await mount()).toBe("/");
    expect(await (await page(tgHash("w_w34-03")))()).toBe("/share/word/w34-03");
    expect(sessionStorage.getItem("lexi:start-consumed")).toBeNull();
  });
  it("неизвестный параметр оставляет «Сегодня»", async () => {
    expect(await (await page(tgHash("promo", "Q1")))()).toBe("/");
  });
});
