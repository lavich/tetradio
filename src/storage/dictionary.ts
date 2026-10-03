import type { LearningRef, Phrase } from "../domain/types";
import { moduleViews } from "./course";
import { db, searchTokens, type AppDatabase, type StoredWord } from "./db";
import { lessonItems, livePhrases, liveWords, stateGroup, statesOf } from "./queries";

export type CardMark = "new" | "learning" | "solid";
export interface DictionaryEntry {
  key: string;
  ref: LearningRef;
  greek: string;
  russian: string;
  mark: CardMark;
  word?: StoredWord;
  phrase?: Phrase;
  tokens: string[];
}
export interface DictionaryLesson {
  id: string;
  moduleId: string;
  moduleNumber: number;
  moduleTitle: string;
  /** «1.2» для урока модуля; у контрольной и повторения номера нет. */
  number: string | null;
  title: string;
  entries: DictionaryEntry[];
}

/**
 * Словарь курса: слова и фразы скачанных уроков в порядке программы. Карточка стоит в уроке, где введена
 * впервые; повтор в следующих уроках её не дублирует. «Учу» — и изучение, и повторение до закрепления.
 */
export async function dictionary(database: AppDatabase = db): Promise<DictionaryLesson[]> {
  const lessons = (await moduleViews(undefined, database)).flatMap((view) => [
    ...view.lessons.map((lesson, index) => ({ view, lesson, number: `${view.module.number}.${index + 1}` })),
    ...[...(view.checkpoint ? [view.checkpoint] : []), ...view.review].map((lesson) => ({
      view,
      lesson,
      number: null,
    })),
  ]);
  const inCourse = new Set(lessons.map(({ lesson }) => lesson.id));
  // Уроки вне модулей остаются в старых профилях: их слова — в конце словаря, без модуля и без ссылки на урок.
  const loose = (await database.lessons.toArray())
    .filter((lesson) => !inCourse.has(lesson.id))
    .map((lesson) => ({
      view: { module: { id: "", number: 0, title: "" } },
      lesson: { id: lesson.id, title: lesson.title, installed: true },
      number: null,
    }));
  const installed = [...lessons.filter(({ lesson }) => lesson.installed), ...loose];
  const items = await Promise.all(installed.map(({ lesson }) => lessonItems(lesson.id, database)));
  const refs = items.flat().map((item) => item.ref);
  const ids = (kind: LearningRef["kind"]) => [...new Set(refs.filter((ref) => ref.kind === kind).map((ref) => ref.id))];
  const [words, phrases, states] = await Promise.all([
    liveWords(ids("word"), database),
    livePhrases(ids("phrase"), database),
    statesOf(refs, database),
  ]);
  const wordById = new Map(words.map((word) => [word.id, word]));
  const phraseById = new Map(phrases.map((phrase) => [phrase.id, phrase]));
  const seen = new Set<string>();
  return installed.map(({ view, lesson, number }, index) => {
    const entries: DictionaryEntry[] = [];
    for (const item of items[index]) {
      if (seen.has(item.unitKey)) continue;
      const word = item.ref.kind === "word" ? wordById.get(item.ref.id) : undefined;
      const phrase = item.ref.kind === "phrase" ? phraseById.get(item.ref.id) : undefined;
      if (!word && !phrase) continue;
      seen.add(item.unitKey);
      const group = stateGroup(states.get(item.unitKey));
      const greek = word?.greek ?? phrase!.text;
      const russian = word?.russian ?? phrase!.translation ?? "";
      entries.push({
        key: item.unitKey,
        ref: item.ref,
        greek,
        russian,
        mark: group === "new" ? "new" : group === "solid" ? "solid" : "learning",
        word,
        phrase,
        tokens: searchTokens(`${greek} ${russian}`),
      });
    }
    return {
      id: lesson.id,
      moduleId: view.module.id,
      moduleNumber: view.module.number,
      moduleTitle: view.module.title,
      number,
      title: lesson.title,
      entries,
    };
  });
}

/** Поиск по началу слов греческого и перевода: каждое слово запроса — начало какого-то слова карточки. */
export function matchesQuery(entry: DictionaryEntry, query: string) {
  const wanted = searchTokens(query);
  return wanted.every((token) => entry.tokens.some((own) => own.startsWith(token)));
}
