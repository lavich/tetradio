import { afterEach, describe, expect, it, vi } from "vitest";
import { httpFetcher } from "../src/content/fetcher";

const catalog = { lessons: [] };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("ранний запрос каталога из app/index.html", () => {
  it("первый запрос каталога забирает ранний ответ, следующий идёт в сеть", async () => {
    const fetch = vi.fn(async () => response({ lessons: ["fresh"] }));
    const page: { __catalog?: Promise<Response> } = { __catalog: Promise.resolve(response(catalog)) };
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", page);
    const source = httpFetcher();
    expect(await source.json("content/catalog.json")).toEqual(catalog);
    expect(fetch).not.toHaveBeenCalled();
    expect(page.__catalog).toBeUndefined();
    expect(await source.json("content/catalog.json")).toEqual({ lessons: ["fresh"] });
    expect(fetch).toHaveBeenCalledWith("/content/catalog.json", { cache: "no-cache" });
  });

  it("пакет урока и другая база ранний ответ не трогают", async () => {
    const early = Promise.resolve(response(catalog));
    const page: { __catalog?: Promise<Response> } = { __catalog: early };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ id: "x" })),
    );
    vi.stubGlobal("window", page);
    await httpFetcher().json("content/packages/x.json");
    await httpFetcher("/web/").json("content/catalog.json");
    expect(page.__catalog).toBe(early);
  });

  it("сбой раннего запроса — та же ошибка сети, что у обычного", async () => {
    const early = Promise.reject(new TypeError("Failed to fetch"));
    early.catch(() => undefined);
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("window", { __catalog: early });
    await expect(httpFetcher().json("content/catalog.json")).rejects.toMatchObject({ kind: "network" });
  });
});
