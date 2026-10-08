import { defineConfig } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_COURSES_PORT ?? 4175);
/**
 * Два курса на одном устройстве — греческий демонстрационный и маленький английский (tests/fixtures/two-courses):
 * свой контент, поэтому свой порт и свой каталог сборки.
 */
export default defineConfig({
  testDir: "tests/e2e-courses",
  timeout: 60000,
  // У каждого теста свой контекст браузера и своя база: тесты независимы и идут параллельно.
  fullyParallel: true,
  workers: process.env.CI ? 2 : "50%",
  // Повтор в CI отделяет нестабильный тест (flaky) от сломанного.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  expect: { timeout: process.env.CI ? 10000 : 5000 },
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `CONTENT_ROOT=tests/fixtures/two-courses npm run content && npx tsc -b && VITE_TELEGRAM_MOCK=1 npx vite build --outDir dist-courses && npx vite preview --outDir dist-courses --host 0.0.0.0 --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
