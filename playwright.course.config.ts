import { defineConfig } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_COURSE_PORT ?? 4174);
/**
 * Экраны курса из модулей — на демонстрационном курсе (tests/fixtures/course-demo), отдельно от фикстуры механик:
 * у сборок разный контент, поэтому свой порт и свой каталог сборки.
 */
export default defineConfig({
  testDir: "tests/e2e-course",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `CONTENT_ROOT=tests/fixtures/course-demo npm run content && npx tsc -b && npx vite build --outDir dist-course && npx vite preview --outDir dist-course --host 0.0.0.0 --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
