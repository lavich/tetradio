/**
 * Отзывчивость урока под замедлением процессора, после установки курса: Event Timing нажатий (от касания
 * до следующего кадра) на страницах урока, p98 по трём прогонам не выше 100 мс.
 *
 *   PERF_RATE=4 PERF_RUNS=3 PERF_PORT=4177 npm run perf
 *
 * Итог — строка JSON, `test-results/perf/session.json` и сводка задачи CI.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { installed, lessonCount, publish } from "./helpers";
import { latencies, percentile, type InteractionEntry } from "./latency";

const RATE = Number(process.env.PERF_RATE ?? 4);
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const COURSE = "greek-a2";
const LIMIT_MS = 100;
const MIN_INTERACTIONS = 30;

const OBSERVE = `(() => {
  window.__events = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.interactionId) window.__events.push({ id: entry.interactionId, duration: entry.duration });
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
})();`;

const results: { latencies: number[] }[] = [];

/** Промах по перерисованному элементу не валит замер: нажатия считает браузер (`interactionCount`). */
const tap = (target: Locator) => target.click({ force: true, timeout: 3000 }).catch(() => undefined);

/** Страница урока: слова, варианты ответа, «Проверить», затем следующая страница. Выбор по CSS: поиск по ролям под ×4 слишком медленный. */
async function playLesson(page: Page) {
  const forward = page.locator('nav[aria-label="Страницы урока"] button:last-child');
  const done = async () => /К итогу/.test((await forward.textContent({ timeout: 5000 }).catch(() => "К итогу")) ?? "");
  for (let turn = 0; turn < 12; turn++) {
    const words = page.locator('button[aria-label^="Произнести и перевести"]');
    for (let index = 0; index < Math.min(4, await words.count()); index++) {
      await tap(words.nth(index));
      await page.keyboard.press("Escape");
    }
    const options = page.locator("article button", { hasText: /^\[/ });
    for (let pick = 0; pick < Math.min(6, await options.count()); pick++) await tap(options.nth(pick));
    const check = page.locator("article button", { hasText: /^Проверить$/ });
    if ((await check.count()) && (await check.isEnabled())) await tap(check);
    if (await done()) break;
    await forward.click({ timeout: 10_000 });
  }
}

test.describe.configure({ mode: "serial" });

for (let run = 1; run <= RUNS; run++)
  test(`урок ×${RATE}, прогон ${run}`, async ({ page, context }) => {
    await context.addInitScript(OBSERVE);
    await page.goto("/app/");
    await page.getByRole("button", { name: "Учить курс «Греческий»" }).click();
    const lesson = page.getByTestId("course-next");
    await lesson.waitFor();
    const total = await lessonCount(page, COURSE);
    while ((await installed(page)) < total) await page.waitForTimeout(500);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    await lesson.click();
    await page.getByRole("article").first().waitFor();
    await playLesson(page);
    const { events, count } = await page.evaluate(() => ({
      events: (window as unknown as { __events: InteractionEntry[] }).__events,
      count: performance.interactionCount,
    }));
    results.push({ latencies: latencies(events, count) });
  });

test("p98 задержки отклика в уроке", () => {
  const all = results.flatMap((result) => result.latencies);
  const p98 = Math.round(percentile(all, 0.98));
  const summary = {
    rate: RATE,
    runs: results.length,
    interactions: all.length,
    p98Ms: p98,
    slowestMs: [...all]
      .sort((a, b) => b - a)
      .slice(0, 5)
      .map(Math.round),
  };
  console.log(JSON.stringify(summary));
  publish("session", `Отклик в уроке ×${RATE}`, [{ ...summary, slowestMs: summary.slowestMs.join(", ") }]);
  expect(all.length, "слишком мало нажатий для p98").toBeGreaterThanOrEqual(MIN_INTERACTIONS);
  expect(p98).toBeLessThanOrEqual(LIMIT_MS);
});
