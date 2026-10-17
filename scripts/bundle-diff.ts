import { existsSync, readFileSync } from "node:fs";
import { METRIC_LABELS, type BundleMetrics } from "./bundle-metrics.ts";

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export function diffTable(head: BundleMetrics, base?: BundleMetrics) {
  if (!base) return "Сравнения с `main` нет: сборка базового коммита не удалась.\n";
  const rows = (Object.keys(METRIC_LABELS) as (keyof BundleMetrics)[]).map((key) => {
    const delta = head[key] - base[key];
    const share = base[key] ? ` (${signed(Math.round((delta / base[key]) * 1000) / 10)} %)` : "";
    return `| ${METRIC_LABELS[key]} | ${base[key]} | ${head[key]} | ${signed(delta)}${delta ? share : ""} |`;
  });
  return ["| Метрика, байт | `main` | PR | Разница |", "|---|---|---|---|", ...rows, ""].join("\n");
}

if (process.argv[1]?.endsWith("bundle-diff.ts")) {
  const [headPath, basePath] = process.argv.slice(2);
  const read = (path?: string) =>
    path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as BundleMetrics) : undefined;
  const head = read(headPath);
  if (!head) throw new Error("bundle-diff: нет метрик ветки");
  process.stdout.write(`### Размер сборки: PR против main\n\n${diffTable(head, read(basePath))}`);
}
