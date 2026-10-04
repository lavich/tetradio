import { optionsFor, phraseOptionsFor, type ExercisePools, type OptionPools } from "./options";
import { availableTypes, chooseTypeFor, type SkillContext } from "./exercise-choice";
import { emptySkills, type SkillSummary } from "./skills";
import type { ExerciseType, Phrase, SessionCard, SessionItem } from "./types";
import { assemblyExercise, objectiveExercise } from "./word-exercise";

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
): Pick<SessionItem, "type" | "options"> | null {
  for (const step of EASIER[type] ?? []) {
    if (step === "assembly") {
      const exercise = card.kind === "word" ? assemblyExercise(card.word, random) : null;
      if (exercise) return exercise;
      continue;
    }
    const options =
      card.kind === "word"
        ? optionsFor(card.word, pools.words, "recognition", random)
        : phraseOptionsFor(card.phrase, pools.phrases, "recognition", random);
    if (options.length === 4) return { type: "recognition", options };
  }
  return null;
}
/** Упражнение для карточки любого вида; `null` — фразу нечем объективно проверить. */
export function exerciseFor(
  card: SessionCard,
  pools: ExercisePools,
  skills: SkillSummary,
  random: () => number,
  hasVoice: boolean,
): Pick<SessionItem, "type" | "options"> | null {
  if (card.kind === "word") return objectiveExercise(card.word, pools.words, skills, random, hasVoice);
  return phraseExercise(card.phrase, pools.phrases, skills, random, hasVoice);
}

/**
 * Фраза: узнавание и написание при переводе, аудирование при голосе или файле и четырёх различных фразах.
 * Слоговой сборки и её условий нет; при недостатке вариантов — написание. Без единого доступного упражнения — `null`.
 */
export function phraseExercise(
  phrase: Phrase,
  pool: Phrase[],
  skills: SkillSummary = emptySkills(),
  random: () => number = Math.random,
  hasVoice = false,
): Pick<SessionItem, "type" | "options"> | null {
  const recognition = phraseOptionsFor(phrase, pool, "recognition", random);
  const listening = phraseOptionsFor(phrase, pool, "listening", random);
  const sounds = !!phrase.audioAssetId || hasVoice;
  const canListen = sounds && listening.length === 4;
  const context: SkillContext = {
    hasAudio: canListen,
    canListen,
    hasOptions: recognition.length === 4,
    canAssemble: false,
    canSpell: !!phrase.translation,
    canComprehend: sounds && recognition.length === 4,
  };
  if (!availableTypes(skills, context).length) return null;
  const type = chooseTypeFor(skills, context);
  return {
    type,
    options: type === "recognition" || type === "comprehension" ? recognition : type === "listening" ? listening : [],
  };
}
