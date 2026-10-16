import { defineConfig } from "@playwright/test";
const port = Number(process.env.PERF_PORT ?? 4177);
/** Замеры на настоящем курсе; не входят в CI, запуск и параметры — в tests/perf/install.perf.ts. */
export default defineConfig({
  testDir: "tests/perf",
  testMatch: /\.perf\.ts$/,
  outputDir: "test-results/perf",
  timeout: 300000,
  // Замер последовательный: параллельные браузеры делили бы процессор и искажали длинные задачи.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: "chromium",
    launchOptions: { args: ["--mute-audio"] },
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `node scripts/e2e-server.ts perf content ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 300000,
  },
});
