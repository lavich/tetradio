import { defineConfig } from "@playwright/test";

interface Suite {
  /** Каталог тестов `tests/<name>` и отчётов `test-results/<name>`. */
  name: string;
  port: number;
  /** Аргументы `scripts/e2e-server.ts` до порта: имя сборки и каталог фикстуры. */
  build: [name: string, fixture: string];
  /** Дополнительная сборка без мока Telegram в `web/` — для экрана «Откройте в Telegram». */
  web?: boolean;
}

/** Общая часть браузерных наборов: у каждого свой порт и свой каталог сборки, так как контент разный. */
export function suiteConfig({ name, port, build, web }: Suite) {
  return defineConfig({
    testDir: `tests/${name}`,
    outputDir: `test-results/${name}`,
    timeout: 60000,
    // У каждого теста свой контекст браузера и своя база: тесты независимы и идут параллельно.
    fullyParallel: true,
    workers: process.env.CI ? 2 : "50%",
    // Повтор в CI отделяет нестабильный тест (flaky) от сломанного; JSON-отчёт читает scripts/check-flaky.ts.
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI
      ? [["github"], ["html", { open: "never" }], ["json", { outputFile: `test-results/${name}.json` }]]
      : "list",
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
      command: ["node scripts/e2e-server.ts", ...build, port, ...(web ? ["--web"] : [])].join(" "),
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 120000,
    },
  });
}
