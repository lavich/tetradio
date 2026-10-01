import { defineConfig } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
/**
 * Браузерные проверки идут по production build, как и реальное использование. Механики проверяются на маленькой
 * фикстуре из слов лексикона (tests/fixtures/mechanics), а не на курсе: его состав меняется вместе с программой.
 * Сборка — с моком Telegram (`VITE_TELEGRAM_MOCK=1`), т. к. тесты идут в обычном Chromium; в `dist/web/` — та же
 * сборка без флага, как на GitHub Pages: на ней проверяется экран «Откройте в Telegram».
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  // У каждого теста свой контекст браузера и своя база: тесты независимы и идут параллельно.
  fullyParallel: true,
  workers: process.env.CI ? 2 : "50%",
  // Runner CI медленнее локальной машины: при четырёх потоках тесты на тайминг падали ложно.
  expect: { timeout: process.env.CI ? 10000 : 5000 },
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `CONTENT_ROOT=tests/fixtures/mechanics npm run content && npx tsc -b && VITE_TELEGRAM_MOCK=1 npx vite build && BASE_PATH=/web/ npx vite build --outDir dist/web && npx vite preview --host 0.0.0.0 --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
