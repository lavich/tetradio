import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Инвентаризация лицензий: прямые зависимости из `package.json` и всё дерево production-зависимостей.
 * Лицензия вне списка разрешённых валит проверку — её надо разобрать и внести в `NOTICE` или заменить пакет.
 */
const ALLOWED = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "OFL-1.1",
  "CC-BY-4.0",
  "(MIT OR CC0-1.0)",
]);

type Package = { name: string; version: string; license?: unknown; location: string };

const root = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
const tree = (
  JSON.parse(execFileSync("npm", ["query", ".prod"], { encoding: "utf8", maxBuffer: 64 << 20 })) as Package[]
).filter((item) => item.location !== "");
const license = (item: Package) => (typeof item.license === "string" ? item.license : JSON.stringify(item.license));

console.table(
  Object.keys(root.dependencies).map((name) => {
    const item = tree.find((candidate) => candidate.location === `node_modules/${name}`);
    return { name, version: item?.version ?? "не установлен", license: item ? license(item) : "—" };
  }),
);

const counts = new Map<string, number>();
for (const item of tree) counts.set(license(item), (counts.get(license(item)) ?? 0) + 1);
console.log(`Дерево production-зависимостей: ${tree.length} пакетов.`);
console.table(Object.fromEntries(counts));

const missing = Object.keys(root.dependencies).filter(
  (name) => !tree.some((item) => item.location === `node_modules/${name}`),
);
const rejected = tree.filter((item) => !ALLOWED.has(license(item)));
if (missing.length) console.error(`Не установлены: ${missing.join(", ")}. Запустите npm ci.`);
for (const item of rejected) console.error(`Лицензия не из списка: ${item.name}@${item.version} — ${license(item)}`);
if (missing.length || rejected.length) process.exit(1);
