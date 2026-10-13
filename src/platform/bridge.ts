import type { TelegramWebApp } from "./telegram-types";

export const BRIDGE_URL = "https://telegram.org/js/telegram-web-app.js";
let loading: Promise<TelegramWebApp | null> | null = null;

/**
 * Загрузка официального bridge не блокирует рендер: приложение стартует в браузерном режиме,
 * а Telegram-возможности подключаются, когда скрипт готов. Тайм-аута нет: его ставит вызывающий.
 * Уже присутствующий объект (например, подставленный тестом) используется без сетевой загрузки.
 */
export function loadTelegramBridge(doc: Document = document): Promise<TelegramWebApp | null> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const existing = window.Telegram?.WebApp;
    if (existing && typeof existing.onEvent === "function") return resolve(existing);
    const script = doc.createElement("script");
    script.src = BRIDGE_URL;
    script.async = true;
    script.onload = () =>
      resolve(
        window.Telegram?.WebApp && typeof window.Telegram.WebApp.onEvent === "function" ? window.Telegram.WebApp : null,
      );
    script.onerror = () => resolve(null);
    doc.head.appendChild(script);
  });
  return loading;
}
/** Только для тестов. */
export const resetBridge = () => {
  loading = null;
};
