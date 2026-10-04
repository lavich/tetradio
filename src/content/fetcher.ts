import { ContentError } from "./schema";

export interface ContentFetcher {
  json(url: string): Promise<unknown>;
  blob(url: string): Promise<Blob>;
}

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
export const networkError = (what: string) =>
  new ContentError(
    offline()
      ? `Нет сети: ${what} ещё не загружен на это устройство.`
      : `Не удалось загрузить ${what}. Проверьте соединение и повторите.`,
    "network",
  );

/** Адрес файла контента относительно базы приложения: единый путь для загрузки пакетов и показа медиа. */
export const contentUrl = (url: string, base: string = import.meta.env.BASE_URL) =>
  `${base.endsWith("/") ? base : `${base}/`}${url}`;

export function httpFetcher(base: string = import.meta.env.BASE_URL): ContentFetcher {
  const load = async (url: string, what: string, init?: RequestInit) => {
    let response: Response;
    try {
      response = await fetch(contentUrl(url, base), init);
    } catch {
      throw networkError(what);
    }
    if (!response.ok) throw new ContentError(`Сервер ответил ${response.status} на запрос «${url}».`, "network");
    return response;
  };
  return {
    json: async (url) =>
      (
        await load(
          url,
          url.endsWith("catalog.json") ? "каталог уроков" : "пакет урока",
          url.endsWith("catalog.json") ? { cache: "no-cache" } : undefined,
        )
      )
        .json()
        .catch(() => {
          throw new ContentError("Файл контента повреждён: это не JSON.");
        }),
    blob: async (url) => (await load(url, "файл медиа")).blob(),
  };
}
export let fetcher: ContentFetcher = httpFetcher();
export const useFetcher = (next: ContentFetcher) => {
  fetcher = next;
};
