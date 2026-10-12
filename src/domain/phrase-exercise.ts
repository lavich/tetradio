import { phraseOptionsFor } from "./options";
import { availableTypes, chooseTypeFor, type SkillContext } from "./exercise-choice";
import { emptySkills, type SkillSummary } from "./skills";
import type { Phrase, SessionItem } from "./types";

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
