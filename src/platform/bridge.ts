import type { TelegramWebApp } from "./telegram-types";

export const BRIDGE_URL = "https://telegram.org/js/telegram-web-app.js";
let loading: Promise<TelegramWebApp | null> | null = null;

/**
 * Загрузка официального bridge не блокирует рендер: приложение стартует в браузерном режиме,
 * а Telegram-возможности подключаются, когда скрипт готов. Ошибка или тайм-аут оставляют обычный режим.
 * Уже присутствующий объект (например, подставленный тестом) используется без сетевой загрузки.
 */
export function loadTelegramBridge(timeoutMs = 4000, doc: Document = document): Promise<TelegramWebApp | null> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const existing = window.Telegram?.WebApp;
    if (existing && typeof existing.onEvent === "function") return resolve(existing);
    const script = doc.createElement("script");
    script.src = BRIDGE_URL;
    script.async = true;
    const finish = (value: TelegramWebApp | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    script.onload = () =>
      finish(
        window.Telegram?.WebApp && typeof window.Telegram.WebApp.onEvent === "function" ? window.Telegram.WebApp : null,
      );
    script.onerror = () => finish(null);
    doc.head.appendChild(script);
  });
  return loading;
}
/** Только для тестов. */
export const resetBridge = () => {
  loading = null;
};
