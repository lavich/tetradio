// Картинки слов из Microsoft Fluent Emoji (Flat, MIT) для карточек, которые уже есть в content/words.
// Источник соответствий — docs/course/pictures-map.tsv (id → путь в библиотеке). Скачивает недостающие SVG в
// content/pictures/, пишет content/pictures.yaml и удаляет файлы, которые больше не нужны. Нужна сеть — это шаг
// подготовки контента, не сборки. Запуск: node scripts/pictures-sync.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";

const REPO = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/";
const SOURCE = "Microsoft Fluent Emoji (Flat), лицензия MIT — github.com/microsoft/fluentui-emoji";
const dir = "content/pictures";
mkdirSync(dir, { recursive: true });

const present = new Set(
  readdirSync("content/words").map((file) => String(parse(readFileSync(join("content/words", file), "utf8")).id)),
);
const rows = readFileSync("docs/course/pictures-map.tsv", "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => line.split("\t"));
const words: Record<string, string> = {};
for (const [id, , , asset] of rows) {
  if (!present.has(id)) continue;
  const file = basename(asset).replace(/_flat(_default)?\.svg$/, ".svg");
  const target = join(dir, file);
  if (!existsSync(target)) {
    const response = await fetch(REPO + asset.split("/").map(encodeURIComponent).join("/"));
    if (!response.ok) throw new Error(`${asset}: ${response.status}`);
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  words[id] = file;
}
const used = new Set(Object.values(words));
for (const file of readdirSync(dir)) if (file.endsWith(".svg") && !used.has(file)) rmSync(join(dir, file));
writeFileSync("content/pictures.yaml", stringify({ source: SOURCE, words }, { lineWidth: 0 }));
console.log(`Картинок: ${Object.keys(words).length} (файлов ${used.size}) для слов, которые уже есть в content/`);
