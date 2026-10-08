// Карточки модуля из лексикона: docs/course/lexicon/NN.tsv → content/words/greek-a2/*.yaml и content/phrases/greek-a2/*.yaml.
// Идентификатор берётся из лексикона (w…/p…); имя файла — греческое написание для удобства чтения.
// Существующие файлы не перезаписываются: IPA, примеры и правки редактора остаются. Запуск: node scripts/lexicon-to-content.ts 02
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stringify } from "yaml";

const module = process.argv[2];
if (!/^\d{2}$/.test(module ?? "")) throw new Error("Укажите номер модуля: node scripts/lexicon-to-content.ts 02");
const rows = readFileSync(`docs/course/lexicon/${module}.tsv`, "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => line.split("\t"));
const slug = (text: string) =>
  text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[!;;,.?«»…()'’/]/g, "")
    .trim()
    .replace(/\s+/g, "-");
const source = `Лексикон курса, модуль ${module} (docs/course/lexicon/${module}.tsv)`;
const COURSE = "greek-a2";
mkdirSync(`content/words/${COURSE}`, { recursive: true });
mkdirSync(`content/phrases/${COURSE}`, { recursive: true });
let created = 0,
  kept = 0;
for (const [id, greek, pos, forms, ru, note] of rows) {
  const phrase = pos === "фраза";
  const path = `content/${phrase ? "phrases" : "words"}/${COURSE}/${slug(greek)}.yaml`;
  if (existsSync(path)) {
    kept++;
    continue;
  }
  const doc = phrase
    ? {
        id,
        text: greek,
        translation: ru,
        ...(note ? { note } : {}),
        provenance: {
          sourceLabel: source,
          operation: "requested-generation",
          request: `Лексикон и фразы модуля ${module} курса A0→A2 по программе docs/curriculum.md; языковая проверка — docs/course/lexicon/REVIEW.md`,
        },
      }
    : { id, greek, russian: ru, ...(forms && forms !== "—" ? { forms } : {}), ...(note ? { note } : {}), source };
  writeFileSync(path, stringify(doc, { lineWidth: 0 }));
  created++;
}
console.log(`Модуль ${module}: создано ${created}, уже было ${kept}`);
