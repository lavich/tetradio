/**
 * Проверка письменного ответа для целой фразы. Она отдельна от словарного `checkAnswer`: артикль,
 * отрицание, предлог, форма слова, пунктуация и лишний текст не прощаются и не угадываются — другое
 * написание допускается только явным ответом из материала.
 * Порядок: все точные варианты, затем все варианты без знака ударения (диерезис остаётся значимым).
 * Проверка локальная и детерминированная; генеративный сервис не участвует.
 */
export type TextAnswerStatus = "correct" | "almost" | "wrong";
export interface TextAnswerResult {
  status: TextAnswerStatus;
  message: string;
  /** Вариант для показа: совпавший допустимый либо канонический (первый). */ expected: string;
}

/** NFC, регистр, внешние и повторные пробелы, конечная сигма. Пунктуация остаётся. */
export const normalizeText = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("el").replace(/ς/g, "σ");
/** Снимается только знак ударения (U+0301); диерезис (U+0308) сохраняется. */
export const stripAccent = (value: string) => value.normalize("NFD").replace(/́/g, "").normalize("NFC");

export const MESSAGES = {
  correct: "Правильно!",
  almost: "Почти! Проверь ударение.",
  wrong: "Пока не получилось. Запомним и повторим.",
} as const;

export function checkTextAnswer(answer: string, acceptedAnswers: readonly string[]): TextAnswerResult {
  const canonical = acceptedAnswers[0] ?? "";
  const given = normalizeText(answer);
  if (!given || !acceptedAnswers.length) return { status: "wrong", message: MESSAGES.wrong, expected: canonical };
  const exact = acceptedAnswers.find((accepted) => normalizeText(accepted) === given);
  if (exact !== undefined) return { status: "correct", message: MESSAGES.correct, expected: exact };
  const bare = stripAccent(given);
  const almost = acceptedAnswers.find((accepted) => stripAccent(normalizeText(accepted)) === bare);
  if (almost !== undefined) return { status: "almost", message: MESSAGES.almost, expected: almost };
  return { status: "wrong", message: MESSAGES.wrong, expected: canonical };
}
