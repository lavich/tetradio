// Лексикон по проверенным карточкам: после языковой проверки главный источник — content/words/greek-a2 и content/phrases/greek-a2.
// Для каждой строки docs/course/lexicon/NN.tsv с карточкой в content/ переносит перевод, формы и заметку из карточки.
// Строки без карточки (модули, которых ещё нет в курсе) не трогаются. Запуск: node scripts/lexicon-sync.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

interface Card {
  id: string;
  russian?: string;
  translation?: string;
  forms?: string;
  note?: string;
}
const cards = new Map<string, Card>();
for (const dir of ["content/words/greek-a2", "content/phrases/greek-a2"])
  for (const file of readdirSync(dir)) {
    const card = parse(readFileSync(`${dir}/${file}`, "utf8")) as Card;
    cards.set(card.id, card);
  }
let changed = 0;
for (const file of readdirSync("docs/course/lexicon").filter((name) => /^\d{2}\.tsv$/.test(name))) {
  const path = `docs/course/lexicon/${file}`;
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const next = lines.map((line, index) => {
    if (!index) return line;
    const [id, greek, pos, forms, ru, note = ""] = line.split("\t");
    const card = cards.get(id);
    if (!card) return line;
    const row = [
      id,
      greek,
      pos,
      pos === "фраза" ? forms : (card.forms ?? "—"),
      card.russian ?? card.translation ?? ru,
      card.note ?? "",
    ].join("\t");
    if (row !== [id, greek, pos, forms, ru, note].join("\t")) changed++;
    return row;
  });
  writeFileSync(path, next.join("\n") + "\n");
}
console.log(`Строк лексикона обновлено по карточкам: ${changed}`);
