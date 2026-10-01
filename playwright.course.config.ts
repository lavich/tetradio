import { defineConfig } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_COURSE_PORT ?? 4174);
/**
 * Экраны курса из модулей — на демонстрационном курсе (tests/fixtures/course-demo), отдельно от фикстуры механик:
 * у сборок разный контент, поэтому свой порт и свой каталог сборки. Сборка с моком Telegram, как и у механик.
 */
export default defineConfig({
  testDir: "tests/e2e-course",
  timeout: 60000,
  // У каждого теста свой контекст браузера и своя база: тесты независимы и идут параллельно.
  fullyParallel: true,
  workers: process.env.CI ? 4 : "50%",
  // Четыре браузера и сервер на четырёх ядрах runner: ожиданию в CI нужен запас, иначе редкие ложные падения.
  expect: { timeout: process.env.CI ? 10000 : 5000 },
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `CONTENT_ROOT=tests/fixtures/course-demo npm run content && npx tsc -b && VITE_TELEGRAM_MOCK=1 npx vite build --outDir dist-course && npx vite preview --outDir dist-course --host 0.0.0.0 --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
