import { useLiveQuery } from "dexie-react-hooks";
import { OPTION_POOL, WORD_EXERCISES, wordExerciseOptions, type WordExerciseType } from "../../domain/learning";
import type { Word } from "../../domain/types";
import { useGreekVoice } from "../../shared/audio";
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
  const voice = useGreekVoice();
  // Соседи зависят от слова: без его id в зависимостях доступность считалась бы по соседям прошлого слова.
  const id = word?.id;
  const sources = useLiveQuery(() => (id ? wordSources(id) : undefined), [id]);
  return word && sources && sources.id === word.id ? wordExerciseOptions(word, sources, voice) : undefined;
}
/** Источники вариантов слова вне занятия: близкие — только соседи по урокам. */
export async function wordSources(id: string) {
  const [mates, pool] = await Promise.all([lessonMates([id]), optionPool(OPTION_POOL)]);
  return { id, close: mates.get(id) ?? [], pool };
}
