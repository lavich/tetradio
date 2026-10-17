import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const CLAUDE_COPY = ".claude/skills/feature-flow/SKILL.md";
const AGENTS_COPY = ".agents/skills/feature-flow/SKILL.md";
const CI = ".github/workflows/ci.yml";
// check:flaky разбирает отчёт и в навыке не нужен; test:unit и test:heavy — две половины `npm test`
const NOT_IN_FULL_CHECK = new Set(["check:flaky", "test:unit", "test:heavy"]);

interface Job {
  strategy?: { matrix?: Record<string, unknown[]> };
  steps?: { run?: string; env?: Record<string, string> }[];
}

const jobs = () => (parse(readFileSync(CI, "utf8")) as { jobs: Record<string, Job> }).jobs;

function ciScripts(): string[] {
  const names = new Set<string>();
  for (const job of Object.values(jobs())) {
    const matrix = job.strategy?.matrix ?? {};
    for (const { run } of job.steps ?? []) {
      for (const [, raw] of run?.matchAll(/npm run ((?:[^\s$]|\$\{\{[^}]*\}\})+)/g) ?? []) {
        const keys = [...raw.matchAll(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g)].map((m) => m[1]);
        for (const key of keys) if (!Array.isArray(matrix[key])) throw new Error(`matrix.${key} не список`);
        const variants = keys.reduce(
          (acc, key) => acc.flatMap((name) => matrix[key].map((v) => name.replace(/\$\{\{[^}]*\}\}/, String(v)))),
          [raw],
        );
        for (const name of variants) names.add(name);
      }
    }
  }
  return [...names];
}

function section4(skill: string): string {
  const match = skill.match(/^## 4\.[\s\S]*?(?=^## 5\.)/m);
  if (!match) throw new Error("в навыке нет раздела 4 перед разделом 5");
  return match[0];
}

describe("процесс: навыки и CI", () => {
  it("копии feature-flow идентичны", () => {
    expect(readFileSync(AGENTS_COPY, "utf8")).toBe(readFileSync(CLAUDE_COPY, "utf8"));
  });

  it("полная проверка называет каждую команду CI", () => {
    const section = section4(readFileSync(CLAUDE_COPY, "utf8"));
    const scripts = ciScripts().filter((name) => !NOT_IN_FULL_CHECK.has(name));
    expect(scripts).toEqual(expect.arrayContaining(["spec", "lexicon:check", "check:bundle", "test:e2e:courses"]));
    for (const name of scripts) expect(section, name).toMatch(new RegExp(`npm run ${name}(?![\\w:-])`));
    expect(section).toMatch(/npm test(?![\w:-])/);
  });

  it("npm test запускает оба проекта vitest, которые CI делит на unit и heavy", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(scripts.test).toBe("vitest run");
  });

  it("сборка в навыке получает те же переменные, что в CI", () => {
    const section = section4(readFileSync(CLAUDE_COPY, "utf8"));
    const build = Object.values(jobs())
      .flatMap((job) => job.steps ?? [])
      .find((step) => step.run === "npm run build");
    for (const key of Object.keys(build?.env ?? {})) expect(section, key).toContain(`${key}=`);
  });
});
