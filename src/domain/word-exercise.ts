import { chooseTypeFor, type SkillContext } from "./exercise-choice";
import { optionsFor, shuffleTiles, type WordSources } from "./options";
import { emptySkills, type SkillSummary } from "./skills";
import { languageOfText } from "./language";
import { splitWriting } from "./syllables";
import type { SessionItem, Word } from "./types";

/** Сборка слова: `null` — слогов меньше двух или язык без слогов. Артикль ложится в пул обычной плиткой и ставится наравне со слогами. */
export function assemblyExercise(word: Word, random: () => number): Pick<SessionItem, "type" | "options"> | null {
  if (!languageOfText(word.greek).syllables) return null;
  const writing = splitWriting(word.greek);
  const parts = writing.syllables;
  if (parts.length < 2) return null;
  // Перемешивается весь пул целиком: отсюда и детерминированный поток random для остальных заданий, и порядок, отличный от правильного.
  return { type: "assembly", options: shuffleTiles(writing.article ? [writing.article, ...parts] : parts, random) };
}

/** Виды упражнений слова, которые пользователь может выбрать сам. */
export const WORD_EXERCISES = ["recognition", "assembly", "spelling", "listening", "comprehension"] as const;
export type WordExerciseType = (typeof WORD_EXERCISES)[number];
export type ExerciseAvailability = { available: true } | { available: false; reason: string };
export const NO_SOUND = "Нужен звук: у слова нет файла, а на устройстве нет голоса этого языка";
export const FEW_OPTIONS = "Для вариантов не хватает слов в словаре";
export const ONE_SYLLABLE = "В слове один слог — собирать нечего";
export const NO_SYLLABLES = "Сборка из слогов — только для греческих слов";

/**
 * Данные слова для упражнений: варианты узнавания и аудирования, число слогов, есть ли звук.
 * Варианты подбираются в этом порядке: от него зависит поток `random` и воспроизводимость занятия.
 */
function wordFacts(word: Word, sources: WordSources, random: () => number, hasVoice: boolean) {
  return {
    assembles: languageOfText(word.greek).syllables,
    syllables: languageOfText(word.greek).syllables ? splitWriting(word.greek).syllables.length : 0,
    recognition: optionsFor(word, sources, "recognition", random),
    listening: optionsFor(word, sources, "listening", random),
    sounds: !!word.audioAssetId || hasVoice,
  };
}
type WordFacts = ReturnType<typeof wordFacts>;
/** Условия данных — общие для выбора системой и выбора пользователем; условия навыков добавляет только `chooseTypeFor`. */
const contextOf = (facts: WordFacts): SkillContext => ({
  hasAudio: facts.sounds && facts.listening.length === 4,
  hasOptions: facts.recognition.length === 4,
  canAssemble: facts.syllables >= 2,
  canComprehend: facts.sounds && facts.recognition.length === 4,
});
function availabilityOf(facts: WordFacts): Record<WordExerciseType, ExerciseAvailability> {
  const context = contextOf(facts);
  const when = (ok: boolean | undefined, reason: string): ExerciseAvailability =>
    ok ? { available: true } : { available: false, reason };
  return {
    recognition: when(context.hasOptions, FEW_OPTIONS),
    assembly: when(context.canAssemble, facts.assembles ? ONE_SYLLABLE : NO_SYLLABLES),
    spelling: { available: true },
    listening: facts.sounds ? when(context.hasAudio, FEW_OPTIONS) : when(false, NO_SOUND),
    comprehension: facts.sounds ? when(context.canComprehend, FEW_OPTIONS) : when(false, NO_SOUND),
  };
}
/** Какие упражнения слово может получить по выбору пользователя: только данные слова и устройства, без навыков. */
export function wordExerciseOptions(
  word: Word,
  sources: WordSources,
  hasVoice: boolean,
): Record<WordExerciseType, ExerciseAvailability> {
  return availabilityOf(wordFacts(word, sources, Math.random, hasVoice));
}
/** Упражнение выбранного вида без учёта навыков; `null` — вид слову недоступен. */
export function buildWordExercise(
  word: Word,
  type: WordExerciseType,
  sources: WordSources,
  random: () => number = Math.random,
  hasVoice = false,
): Pick<SessionItem, "type" | "options"> | null {
  const facts = wordFacts(word, sources, random, hasVoice);
  if (!availabilityOf(facts)[type].available) return null;
  if (type === "assembly") return assemblyExercise(word, random);
  return {
    type,
    options: type === "listening" ? facts.listening : type === "spelling" ? [] : facts.recognition,
  };
}

/** Варианты проверяем по уникальным ответам, а не только по размеру словаря. */
export function objectiveExercise(
  word: Word,
  sources: WordSources,
  skills: SkillSummary = emptySkills(),
  random: () => number = Math.random,
  hasVoice = false,
): Pick<SessionItem, "type" | "options"> {
  const facts = wordFacts(word, sources, random, hasVoice);
  const type = chooseTypeFor(skills, contextOf(facts));
  if (type === "assembly") {
    const exercise = assemblyExercise(word, random);
    if (exercise) return exercise;
  }
  return {
    type,
    options:
      type === "recognition" || type === "comprehension"
        ? facts.recognition
        : type === "listening"
          ? facts.listening
          : [],
  };
}
