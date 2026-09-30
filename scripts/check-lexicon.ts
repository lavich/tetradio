// Проверка лексикона курса (docs/course/lexicon/NN.tsv): формат, объёмы, повторы, греческое написание.
// Ошибки роняют проверку, предупреждения — повод для языковой проверки. Запуск: node scripts/check-lexicon.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "docs/course/lexicon";
const HEADER = "id\tgreek\tpos\tforms\tru\tnote";
/** Короткий стабильный идентификатор: не зависит от написания, чтобы правка опечатки не теряла прогресс. */
const ID = /^[wp]\d{3,}$/;
const POS = new Set(["сущ", "глаг", "прил", "нареч", "мест", "числ", "предл", "союз", "част", "межд", "фраза"]);
const ARTICLES = /^(ο|η|το|οι|τα) /;
/** Минимум слов (без фраз) по номеру модуля; сверху допускается запас на числа и опорные слова. */
const target = (module: number) => (module <= 8 ? 35 : module <= 21 ? 40 : 30);
const SLACK = 12;
/**
 * Опорные частотные слова и последний модуль, где они должны быть введены: тематическая генерация по модулям
 * их теряет, а без них не строятся тексты первых уроков.
 */
const CORE: Record<string, number> = Object.fromEntries(
  (
    [
      [2, "με για τώρα μόνο γιατί πηγαίνω θέλω μπορώ ξέρω"],
      [4, "ο_φίλος η_φίλη ο_άνθρωπος κάνω λέω παίρνω δίνω γράφω ότι που άλλος πολύς λίγος όλος ακόμα μισός το_τέταρτο"],
      [
        6,
        "η_δουλειά ο_χρόνος η_νύχτα το_πράγμα τα_λεφτά το_νερό χωρίς μαζί πάλι κάτι τίποτα κάποιος κανένας κακός εύκολος δύσκολος ίδιος αγαπάω ψάχνω βρίσκω ανοίγω κλείνω αρχίζω τελειώνω χρειάζομαι πληρώνω περιμένω όταν",
      ],
      [8, "πρέπει"],
      [10, "αν ήδη πριν"],
    ] as const
  ).flatMap(([module, list]) => list.split(" ").map((word) => [word.replace("_", " "), module])),
);
const GREEK_TEXT = /^[\p{Script=Greek}0-9\s.,;!’'«»\-()/…]+$/u;
/** Односложные слова с ударением по правилу монотоники. */
const ACCENTED_MONOSYLLABLES = new Set(["ή", "πού", "πώς"]);
const ACCENTED = /[άέήίόύώΐΰΆΈΉΊΌΎΏ]/;
/** Гласные группы — приближение числа слогов (диграфы и сочетания с υ как одна группа). */
const syllables = (word: string) =>
  (
    word
      .toLowerCase()
      .normalize("NFC")
      .match(/αι|ει|οι|ου|υι|αυ|ευ|ηυ|[αεηιουωάέήίόύώϊϋΐΰ]/g) ?? []
  ).length;
/** Лемма для поиска повторов: без артикля, в нижнем регистре; ударение различает слова (πότε ≠ ποτέ). */
const lemma = (greek: string) => greek.replace(ARTICLES, "").toLowerCase().trim();

const errors: string[] = [];
const warnings: string[] = [];
const seen = new Map<string, string>();
const ids = new Map<string, string>();
const seenPhrases = new Map<string, string>();
const files = readdirSync(DIR)
  .filter((name) => /^\d{2}\.tsv$/.test(name))
  .sort();
let words = 0;
let phrases = 0;

for (const name of files) {
  const module = Number(name.slice(0, 2));
  const text = readFileSync(join(DIR, name), "utf8");
  if (text !== text.normalize("NFC")) errors.push(`${name}: текст не в NFC`);
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines[0] !== HEADER) errors.push(`${name}: заголовок должен быть «${HEADER.replaceAll("\t", "⇥")}»`);
  let moduleWords = 0;
  let modulePhrases = 0;
  for (const [index, line] of lines.slice(1).entries()) {
    const at = `${name}:${index + 2}`;
    const cells = line.split("\t");
    if (cells.length < 5 || cells.length > 6) {
      errors.push(`${at}: ${cells.length} колонок вместо 6`);
      continue;
    }
    const [id, greek, pos, forms, ru] = cells.map((cell) => cell.trim());
    if (!ID.test(id)) errors.push(`${at}: идентификатор «${id}» — w или p и номер`);
    else if ((pos === "фраза") !== id.startsWith("p"))
      errors.push(`${at}: идентификатор ${id} не того вида (фраза — p, слово — w)`);
    const twinId = ids.get(id);
    if (twinId) errors.push(`${at}: идентификатор ${id} уже занят в ${twinId}`);
    else ids.set(id, at);
    if (!POS.has(pos)) errors.push(`${at}: неизвестная часть речи «${pos}»`);
    if (!ru) errors.push(`${at}: нет перевода`);
    if (!GREEK_TEXT.test(greek)) errors.push(`${at}: «${greek}» содержит не греческие символы`);
    if (/σ(?=$|[\s.,;!])/u.test(greek)) errors.push(`${at}: «${greek}» — σ в конце слова вместо ς`);
    if (pos === "фраза") {
      modulePhrases++;
      // Фраза, как и слово, вводится один раз: повтор в другом модуле — это повторение, а не новая карточка.
      const key = greek
        .normalize("NFC")
        .toLocaleLowerCase("el")
        .replace(/[!;\u037e,.?«»…]/g, "")
        .trim();
      const first = seenPhrases.get(key);
      if (first) errors.push(`${at}: фраза «${greek}» уже есть в ${first}`);
      else seenPhrases.set(key, at);
    } else {
      moduleWords++;
      const key = lemma(greek);
      const first = seen.get(key);
      if (first) errors.push(`${at}: «${greek}» уже есть в ${first}`);
      else seen.set(key, at);
    }
    if (pos === "сущ") {
      if (!ARTICLES.test(greek)) errors.push(`${at}: существительное «${greek}» без артикля`);
      if (forms !== "—" && !/^мн\. (οι|τα) /.test(forms))
        errors.push(`${at}: форма мн. ч. «${forms}» не в формате «мн. οι/τα …»`);
    }
    // Глагол без аориста (είμαι, έχω, ξέρω) даёт прошедшее: «прош. ήμουν».
    if (pos === "глаг" && !/(аор|прош)\. \S+; буд\. θα \S+/.test(forms))
      errors.push(`${at}: у глагола «${greek}» нет «аор. (или прош.) …; буд. θα …»`);
    if (pos === "прил" && forms.split(",").length !== 3) errors.push(`${at}: у прилагательного «${greek}» не три рода`);
    for (const word of greek
      .replace(ARTICLES, "")
      .split(/[\s.,;!«»()/…]+/)
      .filter(Boolean)) {
      const count = syllables(word);
      const accents = (word.match(new RegExp(ACCENTED, "g")) ?? []).length;
      if (count >= 2 && accents === 0) warnings.push(`${at}: «${word}» без ударения`);
      if (count === 1 && accents > 0 && !ACCENTED_MONOSYLLABLES.has(word.toLowerCase()))
        warnings.push(`${at}: односложное «${word}» с ударением`);
      if (accents > 1) warnings.push(`${at}: «${word}» с двумя ударениями`);
    }
  }
  if (moduleWords < target(module) || moduleWords > target(module) + SLACK)
    errors.push(`${name}: ${moduleWords} слов, ожидается ${target(module)}–${target(module) + SLACK}`);
  if (modulePhrases < 10 || modulePhrases > 15) errors.push(`${name}: ${modulePhrases} фраз вместо 10–15`);
  words += moduleWords;
  phrases += modulePhrases;
}

const missing = Array.from({ length: 24 }, (_, index) => `${String(index + 1).padStart(2, "0")}.tsv`).filter(
  (name) => !files.includes(name),
);
if (missing.length) errors.push(`нет файлов: ${missing.join(", ")}`);

for (const [word, deadline] of Object.entries(CORE)) {
  const at = seen.get(lemma(word));
  if (!at) errors.push(`опорное слово «${word}» не введено (нужно до модуля ${deadline})`);
  else if (Number(at.slice(0, 2)) > deadline)
    errors.push(`опорное слово «${word}» введено в ${at}, нужно до модуля ${deadline}`);
}

for (const warning of warnings) console.warn(`предупреждение  ${warning}`);
for (const error of errors) console.error(`ошибка  ${error}`);
console.log(
  `Модулей: ${files.length}, слов: ${words}, фраз: ${phrases}, ошибок: ${errors.length}, предупреждений: ${warnings.length}`,
);
process.exit(errors.length ? 1 : 0);
