/**
 * Разбор вставленного текста. `sourceMastered` — отметка Quizlet из выгрузки: она подсказывает
 * в предпросмотре, что слово в классе уже проходили, и дальше не сохраняется — освоенность в Lexi
 * считается только по ответам пользователя.
 */
export interface ImportRow {
  greek: string;
  russian: string;
  ipa: string;
  sourceMastered: boolean;
  line: number;
}
export interface ImportResult {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
  ignored: number;
  mode: "tsv" | "pairs";
}
export const normalize = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("el");
export const wordKey = (greek: string, russian: string) => `${normalize(greek)}\u0000${normalize(russian)}`;
export function parseImport(text: string): ImportResult {
  const mode = text.includes("\t") ? "tsv" : "pairs";
  const result: ImportResult = { rows: [], errors: [], ignored: 0, mode };
  let mastered = false;
  const lines: { text: string; line: number; mastered: boolean }[] = [];
  text.split(/\r?\n/).forEach((text, index) => {
    const value = text.trim();
    if (!value) return;
    if (/^Mastered\s*\(\d+\)$/i.test(value)) {
      mastered = true;
      result.ignored++;
      return;
    }
    if (/^(You know these terms very well!|Select these\s+\d+)$/i.test(value)) {
      result.ignored++;
      return;
    }
    lines.push({ text: value, line: index + 1, mastered });
  });
  const add = (greek: string, russian: string, ipa: string, line: number, sourceMastered: boolean) => {
    if (!greek || !russian || !/[\u0370-\u03ff\u1f00-\u1fff]/u.test(greek)) {
      result.errors.push({ line, message: "Нужны греческое слово и русский перевод." });
      return;
    }
    result.rows.push({
      greek: greek.normalize("NFC").trim(),
      russian: russian.trim(),
      ipa: ipa.trim(),
      line,
      sourceMastered,
    });
  };
  if (mode === "tsv")
    for (const entry of lines) {
      const cols = entry.text.split("\t");
      if (cols.length < 2 || cols.length > 3) {
        result.errors.push({ line: entry.line, message: "Ожидаются 2 или 3 колонки через табуляцию." });
        continue;
      }
      add(cols[0], cols[1], cols[2] || "", entry.line, entry.mastered);
    }
  else
    for (let i = 0; i < lines.length; i += 2) {
      const entry = lines[i];
      if (!lines[i + 1]) {
        result.errors.push({ line: entry.line, message: "У слова нет перевода." });
        break;
      }
      add(entry.text, lines[i + 1].text, "", entry.line, entry.mastered);
    }
  return result;
}
const article = /^(ο|η|το|οι|τα|τον|την|τους|τις)\s+/u;
const sigmas = (value: string) => normalize(value).replace(/ς/g, "σ");
const noAccent = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\u0301/g, "")
    .normalize("NFC");
export function checkAnswer(
  answer: string,
  expected: string,
): { status: "correct" | "almost" | "wrong"; message: string } {
  const a = sigmas(answer),
    b = sigmas(expected);
  if (a === b) return { status: "correct", message: "Правильно!" };
  if (noAccent(a) === noAccent(b)) return { status: "almost", message: "Почти! Проверь ударение." };
  if (noAccent(a.replace(article, "")) === noAccent(b.replace(article, "")))
    return { status: "almost", message: "Почти! Проверь артикль и ударение." };
  return { status: "wrong", message: "Пока не получилось. Запомним и повторим." };
}
