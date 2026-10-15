import type { Breadcrumb, ErrorEvent } from "@sentry/react";

/**
 * Границы данных отчёта как чистые функции: подключаются в `beforeSend` и `beforeBreadcrumb` SDK,
 * но проверяются отдельно от него. Правила — из спецификации `error-reporting`: адреса режутся до пути,
 * поле пользователя удаляется, дополнительные поля проходят только из разрешённого списка,
 * крошки консоли и кликов отбрасываются; остаются навигация, запросы к собственному контенту и жизненный цикл Mini App.
 */
export const ALLOWED_EXTRA = new Set(["category", "kind", "packageId", "packageVersion", "componentStack"]);
/** Категория собственных крошек приложения: события жизненного цикла Mini App с размерами области просмотра. */
export const LIFECYCLE_CATEGORY = "tetradio.lifecycle";
const HTTP_CATEGORIES = new Set(["fetch", "xhr"]);

const origin = () => (typeof location !== "undefined" ? location.origin : "");

/** Параметры запроса и фрагмент могут нести `initData` и имя бота: остаётся путь; чужой домен сохраняется без параметров. */
export function scrubUrl(url: string, own: string = origin()): string {
  let parsed: URL;
  try {
    parsed = new URL(url, own || "http://localhost");
  } catch {
    return url;
  }
  if (!/^https?:$/.test(parsed.protocol)) return url;
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(url);
  return relative || parsed.origin === own ? parsed.pathname : `${parsed.origin}${parsed.pathname}`;
}
const isOwn = (url: string, own: string) => {
  try {
    return new URL(url, own || "http://localhost").origin === (own || "http://localhost");
  } catch {
    return false;
  }
};

export function filterBreadcrumb(crumb: Breadcrumb, own: string = origin()): Breadcrumb | null {
  const { category } = crumb;
  if (!category) return null;
  if (category === LIFECYCLE_CATEGORY) return crumb;
  if (category === "navigation") {
    const data = crumb.data ?? {};
    return {
      ...crumb,
      data: {
        ...(typeof data.from === "string" ? { from: scrubUrl(data.from, own) } : {}),
        ...(typeof data.to === "string" ? { to: scrubUrl(data.to, own) } : {}),
      },
    };
  }
  if (HTTP_CATEGORIES.has(category)) {
    const data = crumb.data ?? {};
    const url = typeof data.url === "string" ? data.url : "";
    if (!url || !isOwn(url, own)) return null;
    const kept: Record<string, unknown> = { url: scrubUrl(url, own) };
    if (typeof data.method === "string") kept.method = data.method;
    if (typeof data.status_code === "number") kept.status_code = data.status_code;
    return { ...crumb, data: kept };
  }
  return null;
}

/** Имя базы владельца — `tetradio-tg-<бот>-<Telegram ID>` — попадает в тексты ошибок IndexedDB и Dexie. */
const DATABASE_NAME = /tetradio-tg-[\w-]+/g;
const scrubText = (text: string) => text.replace(DATABASE_NAME, "tetradio-tg-…");
const isPlain = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
function scrubTexts(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubText(value);
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  if (!Array.isArray(value) && !isPlain(value)) return value;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) record[key] = scrubTexts(record[key], seen);
  return value;
}

export function scrubEvent<T extends ErrorEvent>(event: T, own: string = origin()): T {
  const seen = new WeakSet<object>();
  for (const key of Object.keys(event) as (keyof T)[])
    // Служебные данные SDK не отправляются и могут ссылаться на его внутренние объекты.
    if (key !== "sdkProcessingMetadata") event[key] = scrubTexts(event[key], seen) as T[keyof T];
  delete event.user;
  if (event.request) {
    const url = event.request.url;
    event.request = typeof url === "string" ? { url: scrubUrl(url, own) } : {};
  }
  if (event.extra) {
    const kept = Object.fromEntries(Object.entries(event.extra).filter(([key]) => ALLOWED_EXTRA.has(key)));
    if (Object.keys(kept).length) event.extra = kept;
    else delete event.extra;
  }
  if (event.breadcrumbs)
    event.breadcrumbs = event.breadcrumbs
      .map((crumb) => filterBreadcrumb(crumb, own))
      .filter((crumb): crumb is Breadcrumb => !!crumb);
  return event;
}
