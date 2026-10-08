/**
 * Проверка письменного ответа для целой фразы. Она отдельна от словарного `checkAnswer`: артикль,
 * отрицание, предлог, форма слова, пунктуация внутри фразы и лишний текст не прощаются и не угадываются —
 * другое написание допускается только явным ответом из материала. Знак в конце фразы необязателен.
 * Порядок: все точные варианты, затем «почти» по профилю языка: в греческом — без знака ударения (диерезис
 * остаётся значимым), в английском — одна буква в слове от пяти букв.
 * Проверка локальная и детерминированная; генеративный сервис не участвует.
 */
export type TextAnswerStatus = "correct" | "almost" | "wrong";
import { PROFILES, type LanguageProfile } from "./language";

const GREEK = PROFILES.el;

export interface TextAnswerResult {
  status: TextAnswerStatus;
  message: string;
  /** Вариант для показа: совпавший допустимый либо канонический (первый). */ expected: string;
}

/** NFC, регистр, внешние и повторные пробелы, конечная сигма, типографский апостроф. Пунктуация остаётся. */
export const normalizeText = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("el").replace(/ς/g, "σ").replace(/[’‘]/g, "'");
const ending = (value: string, profile: LanguageProfile) => value.replace(profile.ending, "");
/** Сокращения пишутся и полностью: `don't` = `do not`; `'s` и `'d` неоднозначны и не раскрываются. */
const expand = (value: string) =>
  value
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bshan't\b/g, "shall not")
    .replace(/n't\b/g, " not")
    .replace(/'m\b/g, " am")
    .replace(/'re\b/g, " are")
    .replace(/'ve\b/g, " have")
    .replace(/'ll\b/g, " will")
    .replace(/\bcan not\b/g, "cannot");
const canonical = (value: string, profile: LanguageProfile) => {
  const text = ending(normalizeText(value), profile);
  return profile.code === "en" ? expand(text) : text;
};
/** Снимается только знак ударения (U+0301); диерезис (U+0308) сохраняется. */
export const stripAccent = (value: string) => value.normalize("NFD").replace(/́/g, "").normalize("NFC");

export const MESSAGES = {
  correct: "Правильно!",
  almost: GREEK.almost.message,
  wrong: "Пока не получилось. Запомним и повторим.",
} as const;

const distance = (a: string, b: string) => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};
/** Опечатка — одна буква в одном слове, и только в слове от пяти букв: в коротком это уже другое слово. */
const typo = (given: string, accepted: string) => {
  const a = given.split(" "),
    b = accepted.split(" ");
  if (a.length !== b.length) return false;
  const differ = b.flatMap((word, index) => (word === a[index] ? [] : [index]));
  return differ.length === 1 && [...b[differ[0]]].length >= 5 && distance(a[differ[0]], b[differ[0]]) === 1;
};
const almostEqual = (given: string, accepted: string, profile: LanguageProfile) =>
  profile.syllables ? stripAccent(given) === stripAccent(accepted) : typo(given, accepted);

export function checkTextAnswer(
  answer: string,
  acceptedAnswers: readonly string[],
  profile: LanguageProfile = GREEK,
): TextAnswerResult {
  const first = acceptedAnswers[0] ?? "";
  const given = canonical(answer, profile);
  if (!given || !acceptedAnswers.length) return { status: "wrong", message: MESSAGES.wrong, expected: first };
  const exact = acceptedAnswers.find((accepted) => canonical(accepted, profile) === given);
  if (exact !== undefined) return { status: "correct", message: MESSAGES.correct, expected: exact };
  const almost = acceptedAnswers.find((accepted) => almostEqual(given, canonical(accepted, profile), profile));
  if (almost !== undefined) return { status: "almost", message: profile.almost.message, expected: almost };
  return { status: "wrong", message: MESSAGES.wrong, expected: first };
}

/** Письменный ответ на слово: в отличие от фразы, пропущенный или неверный артикль — «почти». */
export function checkAnswer(
  answer: string,
  expected: string,
  profile: LanguageProfile = GREEK,
): { status: TextAnswerStatus; message: string } {
  const a = canonical(answer, profile),
    b = canonical(expected, profile);
  if (a === b) return { status: "correct", message: MESSAGES.correct };
  if (almostEqual(a, b, profile)) return { status: "almost", message: profile.almost.message };
  const article = profile.article;
  if (
    article &&
    (a.replace(article, "") === b.replace(article, "") ||
      almostEqual(a.replace(article, ""), b.replace(article, ""), profile))
  )
    return { status: "almost", message: profile.almost.article };
  return { status: "wrong", message: MESSAGES.wrong };
}
