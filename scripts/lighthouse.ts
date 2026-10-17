import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "@playwright/test";
import { inDistOf } from "./bundle-metrics.ts";
import { lazyScripts, verdict, type Request, type Run } from "./lighthouse-report.ts";

/**
 * Lighthouse на mock-сборке (`VITE_TELEGRAM_MOCK=1 npm run build`): мобильный профиль Lighthouse (150 мс, 1,6 Мбит/с, CPU ×4),
 * медиана трёх прогонов. Запуск: `npm run lighthouse [-- --json путь]`; протокол и замеры — docs/perf.md.
 */
const PORT = Number(process.env.LIGHTHOUSE_PORT ?? 4188);
const RUNS = Number(process.env.LIGHTHOUSE_RUNS ?? 3);
const origin = `http://localhost:${PORT}`;
const jsonAt = process.argv.indexOf("--json");
const jsonPath = jsonAt < 0 ? undefined : process.argv[jsonAt + 1];

const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ["--headless=new", "--no-sandbox", "--mute-audio"],
});
const stop = () => {
  preview.kill();
  chrome.kill();
};
try {
  for (let waited = 0; ; waited += 250) {
    if (
      await fetch(`${origin}/app/`).then(
        (response) => response.ok,
        () => false,
      )
    )
      break;
    if (waited > 30_000) throw new Error("lighthouse: vite preview не поднялся");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const runs: Run[] = [];
  let requests: Request[] = [];
  for (let run = 1; run <= RUNS; run++) {
    const result = await lighthouse(`${origin}/app/`, {
      port: chrome.port,
      onlyCategories: ["performance"],
      output: "json",
      logLevel: "error",
    });
    const audits = result!.lhr.audits;
    runs.push({
      lcp: audits["largest-contentful-paint"]!.numericValue!,
      tbt: audits["total-blocking-time"]!.numericValue!,
      weight: audits["total-byte-weight"]!.numericValue!,
    });
    requests = (audits["network-requests"]!.details as unknown as { items: Request[] }).items;
    console.log(`прогон ${run}: ${JSON.stringify(runs.at(-1))}`);
  }
  const lazy = lazyScripts(requests, readFileSync("dist/app/index.html", "utf8"), inDistOf("/"), origin);
  const lazyBytes = lazy.reduce((sum, chunk) => sum + chunk.bytes, 0);
  const result = verdict(runs, lazyBytes);
  console.log(
    `медиана: LCP ${Math.round(result.lcp)} мс, TBT ${Math.round(result.tbt)} мс, вес ${Math.round(result.weight)} байт; ` +
      `ленивые чанки первого экрана: ${lazy.length}, ${lazyBytes} байт (${lazy.map((chunk) => chunk.path).join(", ")})`,
  );
  for (const warning of result.warnings) console.log(`::warning title=Lighthouse::${warning}`);
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ runs, ...result, lazy }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Lighthouse (медиана ${RUNS} прогонов)\n\n| LCP | TBT | Вес | Ленивые чанки |\n|---|---|---|---|\n| ${Math.round(result.lcp)} мс | ${Math.round(result.tbt)} мс | ${Math.round(result.weight)} байт | ${lazy.length}, ${lazyBytes} байт |\n`,
      { flag: "a" },
    );
  if (result.errors.length) {
    console.error(`Бюджет Lighthouse не выдержан:\n- ${result.errors.join("\n- ")}`);
    process.exitCode = 1;
  }
} finally {
  stop();
}
