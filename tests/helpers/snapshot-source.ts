import { LESSON_MATES_RADIUS, programmeOrder, type CardFacts, type SessionSource } from "../../src/domain/learning";
import { unitKey, wordKeyOf, wordRef } from "../../src/domain/refs";
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
  /** Модули программы: задают порядок пройденных уроков; без них — порядок массива `lessons`. */
  modules?: StoredModule[];
  links: { lessonId: string; wordId: string; position: number }[];
  items?: LessonItem[];
  states: LearningState[];
  events: ReviewEvent[];
  sessions: Session[];
  /** Часовой пояс планировщика; без него — Asia/Nicosia. */
  timezone?: string;
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
  return {
    timezone: () => data.timezone ?? "Asia/Nicosia",
    completedLessons: async () =>
      programmeOrder(
        data.lessons.filter((lesson) => lesson.completed),
        modules,
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
    dueStates: async (now) => data.states.filter((state) => new Date(state.card.due).getTime() <= now.getTime()),
    factsOf: async (refs) =>
      new Map(
        refs.filter(isLive).map((ref) => {
          const facts: CardFacts = { kind: ref.kind };
          if (ref.kind === "phrase") {
            const phrase = phrases.get(ref.id)!;
            facts.hasTranslation = !!phrase.translation;
            facts.hasAudio = !!phrase.audioAssetId;
          }
          return [unitKey(ref), facts];
        }),
      ),
    phraseCount: async () => livePhrases.length,
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
    optionPool: async () => [...words.values()],
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
    phrasePool: async () => livePhrases,
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
