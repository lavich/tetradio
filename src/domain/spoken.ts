import type { ExerciseFormat } from "../content/course.ts";
import { PROFILES, type LanguageProfile } from "./language.ts";

const CYRILLIC = /[а-яё]/iu;
/**
 * Что произнести при выборе варианта: предложение с подставленным вариантом — форма слышна в контексте.
 * Русские пояснения в скобках не читаются; если русский остаётся, звучит только сам вариант.
 */
export function spokenChoice(prompt: string, option: string, profile: LanguageProfile = PROFILES.el): string | null {
  const word = profile.script.test(option) && !CYRILLIC.test(option) ? option : null;
  if (!/_{2,}/.test(prompt)) return word;
  if (!word) return null;
  const sentence = prompt
    .replace(/_{2,}/, option)
    .replace(/\s*\([^)]*\)/g, "")
    .trim();
  return CYRILLIC.test(sentence) ? word : sentence;
}

/** Ответ по-русски нечего слушать, а выбор и соединение уже звучат при нажатии варианта. */
export function spokenAnswer(
  format: ExerciseFormat,
  prompt: string,
  answer: string,
  profile: LanguageProfile = PROFILES.el,
): string | null {
  if (format === "gap") return spokenChoice(prompt, answer, profile);
  if (format === "text") return profile.script.test(answer) && !CYRILLIC.test(answer) ? answer : null;
  return null;
}
