import { appendFileSync } from "node:fs";
import type { Reporter } from "vitest/node";
import type { TestModule } from "vitest/node";

export interface FileTime {
  file: string;
  project: string;
  ms: number;
}

/** `heavy` — тесты на больших объёмах: 10 с для них норма (`scale` 30–38 с, `sync-size` ≈11 с), предупреждение значит рост. */
const LIMITS: Record<string, number> = { heavy: 60_000 };
const DEFAULT_LIMIT = 10_000;

export const slowFiles = (times: FileTime[]) =>
  times.filter((time) => time.ms > (LIMITS[time.project] ?? DEFAULT_LIMIT)).sort((a, b) => b.ms - a.ms);

export default class SlowFilesReporter implements Reporter {
  onTestRunEnd(modules: readonly TestModule[]) {
    const times = modules.map((module) => {
      const { duration, collectDuration, setupDuration, environmentSetupDuration, prepareDuration } =
        module.diagnostic();
      return {
        file: module.moduleId.replace(`${process.cwd()}/`, ""),
        project: module.project.name,
        ms: duration + collectDuration + setupDuration + environmentSetupDuration + prepareDuration,
      };
    });
    const slow = slowFiles(times);
    if (!slow.length) return;
    const seconds = (ms: number) => (ms / 1000).toFixed(1);
    for (const time of slow)
      console.log(
        process.env.GITHUB_ACTIONS
          ? `::warning file=${time.file}::тестовый файл идёт ${seconds(time.ms)} с`
          : `Медленный файл: ${time.file} — ${seconds(time.ms)} с`,
      );
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Медленные тестовые файлы\n\n${slow.map((time) => `- \`${time.file}\` — ${seconds(time.ms)} с`).join("\n")}\n`,
      );
  }
}
