import { suiteConfig } from "./playwright.base.ts";
/**
 * Браузерные проверки идут по production build, как и реальное использование. Механики проверяются на маленькой
 * фикстуре из слов лексикона (tests/fixtures/mechanics), а не на курсе: его состав меняется вместе с программой.
 * Сборка — с моком Telegram (`VITE_TELEGRAM_MOCK=1`), т. к. тесты идут в обычном Chromium; в `web/` — та же
 * сборка без флага, как на GitHub Pages: на ней проверяется экран «Откройте в Telegram».
 */
export default suiteConfig({
  name: "e2e",
  port: Number(process.env.PLAYWRIGHT_PORT ?? 4176),
  build: ["mechanics", "tests/fixtures/mechanics"],
  web: true,
});
