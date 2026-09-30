import { defineConfig } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
/**
 * Браузерные проверки идут по production build, как и реальное использование. Механики проверяются на фикстуре
 * контента Tavelori (tests/fixtures/tavelori-content), а не на курсе: он в продукт не входит.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  // У каждого теста свой контекст браузера и своя база: тесты независимы и идут параллельно.
  fullyParallel: true,
  workers: process.env.CI ? 4 : "50%",
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `CONTENT_ROOT=tests/fixtures/tavelori-content npm run build && npx vite preview --host 0.0.0.0 --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
