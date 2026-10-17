/**
 * Отзывчивость экрана во время фоновой установки всего греческого курса: сборка с моком Telegram на настоящем
 * контенте, замедление процессора через CDP, длинные задачи — от «Учить курс» до записи всех пакетов плюс 4 с.
 *
 *   PERF_SCREEN=words|progress|today PERF_RATE=8 PERF_RUNS=3 PERF_PORT=4177 npm run perf
 *
 * По умолчанию «Слова», ×8, три прогона; итог — строка JSON на прогон, сравнивать медиану.
 */
import { test } from "@playwright/test";
import { installed, lessonCount, publish } from "./helpers";

const SCREENS = { words: "Слова", progress: "Прогресс", today: "" } as const;
const SCREEN = (process.env.PERF_SCREEN ?? "words") as keyof typeof SCREENS;
const RATE = Number(process.env.PERF_RATE ?? 8);
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const COURSE = "greek-a2";

const OBSERVE = `(() => {
  window.__longTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__longTasks.push([entry.startTime, entry.duration]);
  }).observe({ type: "longtask", buffered: true });
})();`;

const results: Record<string, number | string>[] = [];

for (let run = 1; run <= RUNS; run++)
  test(`${SCREEN} ×${RATE}, прогон ${run}`, async ({ page, context }) => {
    await context.addInitScript(OBSERVE);
    await page.goto("/app/");
    const learn = page.getByRole("button", { name: "Учить курс «Греческий»" });
    await learn.waitFor();
    const total = await lessonCount(page, COURSE);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    const start = await page.evaluate(() => performance.now());
    await learn.click();
    if (SCREENS[SCREEN]) await page.getByRole("navigation").getByRole("link", { name: SCREENS[SCREEN] }).click();
    while ((await installed(page)) < total) await page.waitForTimeout(500);
    const done = await page.evaluate(() => performance.now());
    await page.waitForTimeout(4000);
    const tasks = (
      await page.evaluate(() => (window as unknown as { __longTasks: [number, number][] }).__longTasks)
    ).filter(([at]) => at >= start);
    const result = {
      screen: SCREEN,
      rate: RATE,
      packages: total,
      installMs: Math.round(done - start),
      tbtMs: Math.round(tasks.reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0)),
      longTasks: tasks.length,
      maxTaskMs: Math.round(Math.max(0, ...tasks.map(([, duration]) => duration))),
    };
    console.log(JSON.stringify(result));
    results.push(result);
    publish("install", `Установка курса ×${RATE}: ${results.length} из ${RUNS}`, results);
  });
