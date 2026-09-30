const VOWELS = "αεηιουωάέήίόύώϊϋΐΰ";
const DIGRAPHS = ["ου", "ού", "ει", "εί", "οι", "οί", "αι", "αί", "αυ", "αύ", "ευ", "εύ", "υι", "ηυ"];
const ACCENTED = "άέήίόύώΐΰ";
const ORDINAL = ["первый", "второй", "третий", "четвёртый", "пятый", "шестой", "седьмой", "восьмой"];
const lower = (value: string) => value.toLocaleLowerCase("el");
const ARTICLES = ["ο", "η", "το", "τα", "οι"];

export function coreWord(greek: string): string {
  const tokens = greek.normalize("NFC").split(/\s+/).filter(Boolean);
  const withoutArticle = tokens.filter((token) => !ARTICLES.includes(lower(token)));
  const source = withoutArticle.length ? withoutArticle : tokens;
  return (
    source.find((token) => [...token].some((char) => ACCENTED.includes(lower(char)))) ??
    source[source.length - 1] ??
    greek
  );
}
const nuclei = (word: string) => {
  const text = lower(word),
    found: { start: number; length: number; accented: boolean }[] = [];
  for (let i = 0; i < text.length;) {
    const pair = text.slice(i, i + 2);
    if (DIGRAPHS.includes(pair)) {
      found.push({ start: i, length: 2, accented: [...pair].some((char) => ACCENTED.includes(char)) });
      i += 2;
      continue;
    }
    if (VOWELS.includes(text[i])) {
      found.push({ start: i, length: 1, accented: ACCENTED.includes(text[i]) });
      i += 1;
      continue;
    }
    i += 1;
  }
  return found;
};
export function stressPosition(greek: string): { index: number; total: number; start: number; length: number } | null {
  const word = coreWord(greek);
  const found = nuclei(word);
  const index = found.findIndex((item) => item.accented);
  return index < 0 ? null : { index, total: found.length, start: found[index].start, length: found[index].length };
}
export function stressNote(greek: string): string | null {
  const position = stressPosition(greek);
  // В новогреческом односложные слова знак ударения не получают.
  if (!position) return "Слово односложное — знак ударения ему не нужен";
  if (position.total < 2) return "Односложное слово — ударение падает на него целиком";
  return `Ударение на ${ORDINAL[position.index] ?? `${position.index + 1}-й`} слог`;
}
