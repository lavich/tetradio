import { optionsFor, phraseOptionsFor, type ExercisePools, type OptionPools } from "./options";
import { KINDS } from "./kinds";
import { PROFILES, type LanguageProfile } from "./language";
import type { SkillSummary } from "./skills";
import type { ExerciseType, SessionCard, SessionItem } from "./types";
import { assemblyExercise } from "./word-exercise";

/**
 * Ступени вниз после ошибки: попытка сразу после показанного ответа должна быть поддержанной,
 * а не повторным экзаменом. Сборка даёт слоги, узнавание — готовые ответы; ниже узнавания ступеней нет.
 */
const EASIER: Partial<Record<ExerciseType, ExerciseType[]>> = {
  spelling: ["assembly", "recognition"],
  assembly: ["recognition"],
  comprehension: ["recognition"],
};
/** Есть ли под заданием ступень: пул вариантов читается только ради неё. */
export const hasEasierStep = (type: ExerciseType) => !!EASIER[type];
/**
 * Упражнение дополнительной попытки: ближайшая доступная ступень проще провалённой.
 * `null` — ступени нет (узнавание, аудирование, нехватка слогов или вариантов): попытка повторяет то же задание.
 * Условие открытия написания здесь не действует: попытка идёт вниз по ступеням, а не вверх.
 */
export function easierExercise(
  card: SessionCard,
  type: ExerciseType,
  pools: OptionPools,
  random: () => number = Math.random,
  profile: LanguageProfile = PROFILES.el,
): Pick<SessionItem, "type" | "options"> | null {
  for (const step of EASIER[type] ?? []) {
    if (step === "assembly") {
      const exercise = card.kind === "word" ? assemblyExercise(card.word, random, profile) : null;
      if (exercise) return exercise;
      continue;
    }
    const options =
      card.kind === "word"
        ? optionsFor(card.word, pools.words, "recognition", random, profile)
        : phraseOptionsFor(card.phrase, pools.phrases, "recognition", random);
    if (options.length === 4) return { type: "recognition", options };
  }
  return null;
}
/** Упражнение для карточки любого вида; `null` — карточку нечем объективно проверить. */
export function exerciseFor(
  card: SessionCard,
  pools: ExercisePools,
  skills: SkillSummary,
  random: () => number,
  hasVoice: boolean,
  profile: LanguageProfile = PROFILES.el,
): Pick<SessionItem, "type" | "options"> | null {
  return KINDS[card.kind].exercise(card, pools, skills, random, hasVoice, profile);
}
