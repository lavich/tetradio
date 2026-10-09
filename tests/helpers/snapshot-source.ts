import { LESSON_MATES_RADIUS, programmeOrder, type CardFacts, type SessionSource } from "../../src/domain/learning";
import { unitKey, wordKeyOf, wordRef } from "../../src/domain/refs";
import { DEFAULT_LANGUAGE, type Language } from "../../src/domain/language";
import { byTime, emptyStats, foldStats, summarizeEvents } from "../../src/domain/skills";
import { cardLabel, type StatsSource } from "../../src/domain/stats";
import {
  type CardKind,
  type Course,
  type LearningRef,
  type LearningState,
  type Lesson,
  type LessonItem,
  type Phrase,
  type ReviewEvent,
  type Session,
  type SessionCard,
  type StoredModule,
  type Word,
} from "../../src/domain/types";

/**
 * Полный снимок данных — источник для планировщика в тестах. Словарные связи `links` и смешанные `items`
 * складываются: так прежние сценарии остаются словарными без переписывания.
 */
export interface Snapshot {
  words: Word[];
  phrases?: Phrase[];
  lessons: Lesson[];
  courses?: Course[];
  /** Выполненные задания уроков: урок с ними — начатый и тоже даёт новые карточки. */
  blockProgress?: { lessonId: string; done: boolean }[];
  /** Модули программы: задают порядок пройденных уроков; без них — порядок массива `lessons`. */
  modules?: StoredModule[];
  links: { lessonId: string; wordId: string; position: number }[];
  items?: LessonItem[];
  states: LearningState[];
  events: ReviewEvent[];
  sessions: Session[];
  /** Часовой пояс планировщика; без него — Asia/Nicosia. */
  timezone?: string;
  /** Язык курса по id; без записи — язык по умолчанию. */
  languages?: Record<string, Language>;
}

export const itemOfLink = (link: Snapshot["links"][number]): LessonItem => ({
  lessonId: link.lessonId,
  unitKey: wordKeyOf(link.wordId),
  ref: wordRef(link.wordId),
  position: link.position,
});

/**
 * Источник из полного снимка в памяти. Нужен тестам: те же правила планирования проверяются
 * на снимке и на базе, поэтому новая выборка обязана давать тот же результат, что и старый снимок.
 */
export function fromSnapshot(data: Snapshot): SessionSource & StatsSource {
  const modules = data.modules ?? [];
  const items: LessonItem[] = [...data.links.map(itemOfLink), ...(data.items ?? [])];
  const words = new Map(data.words.map((word) => [word.id, word]));
  const phrases = new Map((data.phrases ?? []).map((phrase) => [phrase.id, phrase]));
  const record = (ref: LearningRef) => (ref.kind === "word" ? words.get(ref.id) : phrases.get(ref.id));
  const isLive = (ref: LearningRef) => !!record(ref);
  const states = new Map(data.states.map((state) => [state.unitKey, state]));
  const livePhrases = [...phrases.values()];
  const sorted = (events: typeof data.events) => [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const cardOf = (ref: LearningRef): SessionCard | undefined => {
    if (!isLive(ref)) return undefined;
    return ref.kind === "word"
      ? { kind: "word", word: words.get(ref.id)! }
      : { kind: "phrase", phrase: phrases.get(ref.id)! };
  };
  const total = (kind: CardKind) => (kind === "word" ? data.words.length : phrases.size);
  // Урок без курса и карточка вне уроков — у основного курса, первого в снимке.
  const primary = data.courses?.[0]?.id;
  const lessonCourse = new Map(data.lessons.map((lesson) => [lesson.id, lesson.courseId ?? primary]));
  const cardCourse = (key: string) => {
    const item = items.find((entry) => entry.unitKey === key);
    return item ? lessonCourse.get(item.lessonId) : primary;
  };
  const inCourse = (courseId: string | undefined) => (key: string) => !courseId || cardCourse(key) === courseId;
  const courseIds = (kind: CardKind, courseId: string) =>
    [
      ...new Set(
        items
          .filter((item) => item.ref.kind === kind && lessonCourse.get(item.lessonId) === courseId)
          .map((item) => item.ref.id),
      ),
    ].sort();
  const languageOf = (key: string) => {
    const course = cardCourse(key);
    return course ? data.languages?.[course] : undefined;
  };
  return {
    timezone: () => data.timezone ?? "Asia/Nicosia",
    studiedLessons: async (courseId) =>
      programmeOrder(
        data.lessons.filter(
          (lesson) =>
            (!courseId || lessonCourse.get(lesson.id) === courseId) &&
            (lesson.completed || (data.blockProgress ?? []).some((row) => row.lessonId === lesson.id && row.done)),
        ),
        courseId ? modules.filter((module) => module.courseId === courseId) : modules,
        (id) => data.lessons.findIndex((lesson) => lesson.id === id),
      ),
    itemsOf: async (lessonIds) => items.filter((item) => lessonIds.includes(item.lessonId)),
    lessonRefs: async (lessonId) =>
      items
        .filter((item) => item.lessonId === lessonId)
        .sort((a, b) => a.position - b.position || a.unitKey.localeCompare(b.unitKey))
        .map((item) => item.ref),
    statesOf: async (refs) =>
      new Map(
        refs
          .map(unitKey)
          .filter((key) => states.has(key))
          .map((key) => [key, states.get(key)!]),
      ),
    liveKeys: async (refs) => new Set(refs.filter(isLive).map(unitKey)),
    dueStates: async (now, courseId) =>
      data.states.filter(
        (state) => new Date(state.card.due).getTime() <= now.getTime() && inCourse(courseId)(state.unitKey),
      ),
    factsOf: async (refs) =>
      new Map(
        refs.filter(isLive).map((ref) => {
          const facts: CardFacts = { kind: ref.kind };
          if (ref.kind === "phrase") {
            const phrase = phrases.get(ref.id)!;
            facts.hasTranslation = !!phrase.translation;
            facts.hasAudio = !!phrase.audioAssetId;
            const language = languageOf(unitKey(ref));
            if (language) facts.language = language;
          }
          return [unitKey(ref), facts];
        }),
      ),
    phraseCount: async (courseId) =>
      courseId ? courseIds("phrase", courseId).filter((id) => phrases.has(id)).length : livePhrases.length,
    languagesOf: async (refs) =>
      new Map(refs.map((ref) => [unitKey(ref), languageOf(unitKey(ref)) ?? DEFAULT_LANGUAGE] as const)),
    cardsOf: async (refs) =>
      new Map(
        refs
          .map((ref) => [unitKey(ref), cardOf(ref)] as const)
          .filter((entry): entry is [string, SessionCard] => !!entry[1]),
      ),
    skillsOf: async (card) =>
      summarizeEvents(
        unitKey(card.kind === "word" ? wordRef(card.word.id) : { kind: "phrase", id: card.phrase.id }),
        data.events,
      ),
    optionPool: async (_want, courseId) =>
      courseId ? courseIds("word", courseId).flatMap((id) => words.get(id) ?? []) : [...words.values()],
    lessonMatesOf: async (wordIds) =>
      new Map(
        wordIds.map((id) => {
          const mates = new Set<string>();
          for (const link of items)
            if (link.ref.kind === "word" && link.ref.id === id)
              for (const item of items)
                if (
                  item.lessonId === link.lessonId &&
                  item.ref.kind === "word" &&
                  item.ref.id !== id &&
                  Math.abs(item.position - link.position) <= LESSON_MATES_RADIUS
                )
                  mates.add(item.ref.id);
          return [id, [...mates].flatMap((mate) => (isLive(wordRef(mate)) ? [words.get(mate)!] : []))] as const;
        }),
      ),
    phrasePool: async (_want, courseId) =>
      courseId ? courseIds("phrase", courseId).flatMap((id) => phrases.get(id) ?? []) : livePhrases,
    daysBetween: async (from, to) =>
      byTime(data.events.filter((event) => event.localDate >= from && event.localDate <= to)).reduce(
        (summary, event) => foldStats(summary, event, Infinity),
        emptyStats(),
      ).days,
    recentByType: async (type, limit) =>
      sorted(data.events.filter((event) => event.type === type))
        .slice(-limit)
        .map((event) => (event.correct === null ? event.rating > 1 : event.correct)),
    dueKeysBefore: async (instant) =>
      data.states
        .filter((state) => new Date(state.card.due).getTime() < instant.getTime())
        .map((state) => state.unitKey),
    cardCount: async () => total("word") + total("phrase"),
    eachState: async (visit) => {
      for (const state of data.states) visit(state);
    },
    labelsOf: async (refs) =>
      new Map(
        refs.flatMap((ref) => {
          const card = cardOf(ref);
          return card ? [[unitKey(ref), cardLabel(card)] as [string, string]] : [];
        }),
      ),
    totals: async () => {
      const keys = new Set(data.events.map((event) => event.unitKey));
      const byKind: Record<CardKind, number> = { word: 0, phrase: 0 };
      // Ключи снятых видов остаются в старых событиях: своего разряда у них нет.
      for (const event of data.events)
        if (keys.delete(event.unitKey) && event.ref.kind in byKind) byKind[event.ref.kind]++;
      return { answers: data.events.length, cards: byKind.word + byKind.phrase, byKind };
    },
  };
}
