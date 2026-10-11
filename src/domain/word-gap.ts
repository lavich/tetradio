import { stripAccent, type LanguageProfile } from "./language";
import { normalizeText } from "./text-answer";

/** Ошибка в одном слове ищется только во фразе не короче этого: в короткой одно слово — заметная её часть. */
export const GAP_MIN_WORDS = 4;

/** Слова фразы, как их делит маска написания: токены по пробелам, в которых есть буква. */
export const phraseWords = (text: string) => text.split(/\s+/).filter((token) => /\p{L}/u.test(token));
/** Слово без знаков препинания вокруг: «παιδιά.» и «παιδιά» — одно слово. */
export const wordCore = (token: string) => token.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, "");
/** Ответ на пропуск: апостроф элизии («σ'») слово не меняет. */
export const gapAnswer = (text: string) => text.trim().replace(/['’]$/u, "");

/**
 * Номер слова ключа, на котором ответ на написание фразы ошибся ровно одним словом (замена или пропуск),
 * или `null`. Вызывается только для неверного ответа: точное совпадение и «почти» по ударению уже разобрал
 * `checkTextAnswer`. Остальные слова сравниваются с допуском на ударение; различие только в пунктуации
 * и потерянное или подменённое отрицание одним словом не считаются. Только греческий: английский профиль
 * раскрывает сокращения, и позиции слов разошлись бы с показанным ключом.
 */
export function gapOf(answer: string, key: string, profile: LanguageProfile): number | null {
  if (profile.code !== "el") return null;
  const canon = (token: string) => profile.canonical(normalizeText(wordCore(token)));
  const same = (given: string, expected: string) => {
    const a = canon(given);
    const b = canon(expected);
    return a === b || profile.isAlmost(a, b);
  };
  const keyWords = phraseWords(key);
  const given = phraseWords(answer);
  // Числа словами не считаются, но ошибка в числе — это ещё одна ошибка.
  const numbers = (text: string) => text.match(/\d+/g)?.join(" ") ?? "";
  if (numbers(answer) !== numbers(key)) return null;
  if (keyWords.length < GAP_MIN_WORDS) return null;
  let at: number | null = null;
  if (given.length === keyWords.length) {
    const wrong = keyWords.flatMap((word, index) => (same(given[index], word) ? [] : [index]));
    if (wrong.length === 1) at = wrong[0];
  } else if (given.length === keyWords.length - 1) {
    const first = keyWords.findIndex((word, index) => index >= given.length || !same(given[index], word));
    if (given.slice(first).every((word, index) => same(word, keyWords[first + index + 1]))) at = first;
  }
  if (at === null) return null;
  const negations = profile.negations.map((word) => stripAccent(normalizeText(word)));
  const negation = (token: string | undefined) => token !== undefined && negations.includes(stripAccent(canon(token)));
  if (negation(keyWords[at]) || (given.length === keyWords.length && negation(given[at]))) return null;
  return at;
}

/** Фраза с пропуском на месте слова; знаки препинания у слова остаются. */
export function gapped(text: string, gap: number, fill = "___") {
  let index = -1;
  return text
    .split(/(\s+)/)
    .map((token) => {
      if (!/\p{L}/u.test(token) || ++index !== gap) return token;
      const core = wordCore(token);
      return token.replace(core, fill);
    })
    .join("");
}
export const gapWord = (text: string, gap: number) => wordCore(phraseWords(text)[gap] ?? "");
