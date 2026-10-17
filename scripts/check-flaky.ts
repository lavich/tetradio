import { appendFileSync, readFileSync } from "node:fs";

interface Test {
  status: string;
}
interface Spec {
  title: string;
  file: string;
  tests: Test[];
}
interface Suite {
  suites?: Suite[];
  specs?: Spec[];
}

/** Тест, прошедший только с повтора, Playwright помечает `flaky`: `retries` в CI скрывает такие тесты от зелёной сборки. */
const flaky = (suite: Suite): string[] => [
  ...(suite.specs ?? [])
    .filter((spec) => spec.tests.some((test) => test.status === "flaky"))
    .map((spec) => `${spec.file} › ${spec.title}`),
  ...(suite.suites ?? []).flatMap(flaky),
];

const escape = (text: string) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const found: string[] = [];
for (const file of process.argv.slice(2)) {
  try {
    found.push(...((JSON.parse(readFileSync(file, "utf8")) as Suite).suites ?? []).flatMap(flaky));
  } catch {
    console.log(`::warning title=Отчёт e2e не прочитан::${escape(file)}`);
  }
}
for (const name of found) console.log(`::warning title=Нестабильный e2e-тест::${escape(name)}`);
const summary = found.length ? `### Нестабильные e2e-тесты\n\n${found.map((name) => `- ${name}`).join("\n")}\n` : "";
if (process.env.GITHUB_STEP_SUMMARY && summary) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(found.length ? `Нестабильных тестов: ${found.length}` : "Нестабильных тестов нет");
