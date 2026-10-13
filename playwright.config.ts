import { defineConfig } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4176);
/**
 * Браузерные проверки идут по production build, как и реальное использование. Механики проверяются на маленькой
 * фикстуре из слов лексикона (tests/fixtures/mechanics), а не на курсе: его состав меняется вместе с программой.
 * Сборка — с моком Telegram (`VITE_TELEGRAM_MOCK=1`), т. к. тесты идут в обычном Chromium; в `web/` — та же
 * сборка без флага, как на GitHub Pages: на ней проверяется экран «Откройте в Telegram».
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  timeout: 60000,
  // У каждого теста свой контекст браузера и своя база: тесты независимы и идут параллельно.
  fullyParallel: true,
  workers: process.env.CI ? 2 : "50%",
  // Повтор в CI отделяет нестабильный тест (flaky) от сломанного.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Runner CI медленнее локальной машины: при четырёх потоках тесты на тайминг падали ложно.
  expect: { timeout: process.env.CI ? 10000 : 5000 },
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: "chromium",
    launchOptions: { args: ["--mute-audio"] },
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node scripts/e2e-server.ts mechanics tests/fixtures/mechanics ${port} --web`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
