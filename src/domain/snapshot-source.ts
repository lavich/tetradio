import { LESSON_MATES_RADIUS, localDay, programmeOrder, type CardFacts, type SessionSource } from "./learning";
import { itemOfLink, unitKey, wordRef } from "./refs";
import { byTime, emptyStats, foldStats, summarizeEvents } from "./skills";
import { cardLabel, type StatsSource } from "./stats";
import {
  DEFAULT_NEW_ITEMS_PER_DAY,
  fillSettings,
  LOCAL_COURSE,
  type CardKind,
  type LearningRef,
  type LessonItem,
  type SessionCard,
  type Snapshot,
} from "./types";

/**
 * Источник из полного снимка в памяти. Нужен тестам: те же правила планирования проверяются
 * на снимке и на базе, поэтому новая выборка обязана давать тот же результат, что и старый снимок.
 */
export function fromSnapshot(data: Snapshot): SessionSource & StatsSource {
  const settings = fillSettings(data.settings);
  const modules = data.modules ?? [];
  // Курс выбирается как в базе: курс модулей, иначе первый по id не локальный, иначе любой.
  const courses = [...(data.courses ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const course =
    (modules.length ? courses.find((c) => c.id === modules[0].courseId) : undefined) ??
    courses.find((c) => c.id !== LOCAL_COURSE) ??
    courses[0];
  const items: LessonItem[] = [...data.links.map(itemOfLink), ...(data.items ?? [])];
  const words = new Map(data.words.map((word) => [word.id, word]));
  const phrases = new Map((data.phrases ?? []).map((phrase) => [phrase.id, phrase]));
  const record = (ref: LearningRef) => (ref.kind === "word" ? words.get(ref.id) : phrases.get(ref.id));
  const isLive = (ref: LearningRef) => {
    const row = record(ref);
    return !!row && !row.deletedAt;
  };
  const states = new Map(data.states.map((state) => [state.unitKey, state]));
  const deleted = new Set<string>();
  for (const word of data.words) if (word.deletedAt) deleted.add(unitKey(wordRef(word.id)));
  for (const phrase of phrases.values()) if (phrase.deletedAt) deleted.add(unitKey({ kind: "phrase", id: phrase.id }));
  const liveWordIds = [...words.values()].filter((word) => !word.deletedAt).map((word) => word.id);
  const livePhrases = [...phrases.values()].filter((phrase) => !phrase.deletedAt);
  const sorted = (events: typeof data.events) => [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const cardOf = (ref: LearningRef): SessionCard | undefined => {
    if (!isLive(ref)) return undefined;
    return ref.kind === "word"
      ? { kind: "word", word: words.get(ref.id)! }
      : { kind: "phrase", phrase: phrases.get(ref.id)! };
  };
  const total = (kind: CardKind) => (kind === "word" ? data.words.length : phrases.size);
  return {
    settings: async () => settings,
    newItemsPerDay: async () => course?.newItemsPerDay ?? DEFAULT_NEW_ITEMS_PER_DAY,
    completedLessons: async () =>
      programmeOrder(
        data.lessons.filter((lesson) => lesson.status === "completed"),
        modules,
        (id) => data.lessons.findIndex((lesson) => lesson.id === id),
      ),
    itemsOf: async (lessonIds) => items.filter((item) => lessonIds.includes(item.lessonId)),
    lessonRefs: async (lessonId) =>
      items
        .filter((item) => item.lessonId === lessonId)
        .sort((a, b) => a.position - b.position || a.unitKey.localeCompare(b.unitKey))
        .map((item) => item.ref),
    introducedToday: async (today, timezone) =>
      data.states.filter((state) => localDay(new Date(state.introducedAt), timezone) === today).length,
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
    optionPool: async () => liveWordIds.map((id) => words.get(id)!),
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
    deletedKeys: async () => deleted,
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
