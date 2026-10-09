import { useLiveQuery } from "dexie-react-hooks";
import { OPTION_POOL, WORD_EXERCISES, wordExerciseOptions, type WordExerciseType } from "../../domain/learning";
import type { Word } from "../../domain/types";
import { unitKey, wordRef } from "../../domain/refs";
import { useVoice } from "../../shared/audio";
import { useProfile } from "../../shared/language";
import { courseOfCard } from "../../storage/courses";
import { lessonMates, optionPool } from "../../storage/queries";

export const EXERCISE_LABELS: Record<WordExerciseType, string> = {
  recognition: "Узнавание",
  assembly: "Сборка из слогов",
  spelling: "Написание",
  listening: "Аудирование",
  comprehension: "Понимание на слух",
};
export const isWordExercise = (value: string | undefined): value is WordExerciseType =>
  (WORD_EXERCISES as readonly string[]).includes(value ?? "");
export const exercisePath = (wordId: string, type: WordExerciseType) =>
  `/words/${encodeURIComponent(wordId)}/exercise/${type}`;

/**
 * Какие упражнения слово может получить по выбору пользователя; `undefined` — ещё читается пул вариантов.
 * Хук живёт здесь, а не в `shared/store`: тому пришлось бы импортировать `shared/audio`, который сам импортирует `store`.
 */
export function useWordExercises(word: Word | undefined) {
  const profile = useProfile();
  const voice = useVoice(profile);
  // Соседи зависят от слова: без его id в зависимостях доступность считалась бы по соседям прошлого слова.
  const id = word?.id;
  const sources = useLiveQuery(() => (id ? wordSources(id) : undefined), [id]);
  return word && sources && sources.id === word.id ? wordExerciseOptions(word, sources, voice, profile) : undefined;
}
/** Источники вариантов слова вне занятия: близкие — только соседи по урокам, пул — слова курса этого слова. */
export async function wordSources(id: string) {
  const key = unitKey(wordRef(id));
  const courseId = await courseOfCard(key);
  const [mates, pool] = await Promise.all([lessonMates([id]), optionPool(OPTION_POOL, courseId)]);
  return { id, close: mates.get(id) ?? [], pool };
}
