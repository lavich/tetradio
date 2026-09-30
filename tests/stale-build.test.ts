import { describe, expect, it } from "vitest";
import { loadScreen } from "../src/app/stale-build";

const staleChunk = () => Promise.reject(new TypeError("Importing a module script failed."));
function environment(options: { online?: boolean; stored?: string } = {}) {
  const store = new Map<string, string>();
  if (options.stored !== undefined) store.set("lexi:stale-build-reload", options.stored);
  const env = {
    reloads: 0,
    at: 100_000,
    store,
    options: {
      storage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
      reload: () => {
        env.reloads++;
      },
      online: () => options.online ?? true,
      now: () => env.at,
    },
  };
  return env;
}
const settled = async (promise: Promise<unknown>) => {
  let state = "pending";
  promise.then(
    () => (state = "resolved"),
    () => (state = "rejected"),
  );
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return state;
};

describe("экран из удалённой сборки", () => {
  it("загруженный экран отдаётся как есть, перезагрузки нет", async () => {
    const env = environment();
    const module = { Screen: () => null };
    await expect(loadScreen(() => Promise.resolve(module), env.options)).resolves.toBe(module);
    expect(env.reloads).toBe(0);
  });
  it("чанк старой сборки не загрузился: страница перезагружается один раз, экран ждёт перезагрузки, а не падает", async () => {
    const env = environment();
    const loading = loadScreen(staleChunk, env.options);
    expect(await settled(loading)).toBe("pending");
    expect(env.reloads).toBe(1);
    expect(env.store.get("lexi:stale-build-reload")).toBe("100000");
  });
  it("повторный отказ вскоре после перезагрузки уходит в границу ошибок: без бесконечного цикла", async () => {
    const env = environment({ stored: "90000" });
    await expect(loadScreen(staleChunk, env.options)).rejects.toThrow("Importing a module script failed.");
    expect(env.reloads).toBe(0);
  });
  it("давняя перезагрузка не мешает новой", async () => {
    const env = environment({ stored: "1000" });
    expect(await settled(loadScreen(staleChunk, env.options))).toBe("pending");
    expect(env.reloads).toBe(1);
  });
  it("без сети перезагрузка оставила бы пустую страницу WebView: отказ уходит в границу ошибок", async () => {
    const env = environment({ online: false });
    await expect(loadScreen(staleChunk, env.options)).rejects.toThrow(TypeError);
    expect(env.reloads).toBe(0);
  });
  it("ошибка не загрузки модуля не лечится перезагрузкой", async () => {
    const env = environment();
    await expect(loadScreen(() => Promise.reject(new RangeError("boom")), env.options)).rejects.toThrow("boom");
    expect(env.reloads).toBe(0);
  });
  it("без sessionStorage защиты от цикла нет, поэтому страница не перезагружается", async () => {
    const env = environment();
    const broken = {
      ...env.options,
      storage: {
        getItem: () => {
          throw new DOMException("denied", "SecurityError");
        },
        setItem: () => undefined,
      },
    };
    await expect(loadScreen(staleChunk, broken)).rejects.toThrow(TypeError);
    expect(env.reloads).toBe(0);
  });
});
