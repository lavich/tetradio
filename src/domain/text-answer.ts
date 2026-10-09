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
const canonical = (value: string, profile: LanguageProfile) => profile.canonical(normalizeText(value));

export const MESSAGES = {
  correct: "Правильно!",
  almost: GREEK.almost.message,
  wrong: "Пока не получилось. Запомним и повторим.",
} as const;

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
  const almost = acceptedAnswers.find((accepted) => profile.isAlmost(given, canonical(accepted, profile)));
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
  if (profile.isAlmost(a, b)) return { status: "almost", message: profile.almost.message };
  const article = profile.article;
  if (
    article &&
    (a.replace(article, "") === b.replace(article, "") ||
      profile.isAlmost(a.replace(article, ""), b.replace(article, "")))
  )
    return { status: "almost", message: profile.almost.article };
  return { status: "wrong", message: MESSAGES.wrong };
}
