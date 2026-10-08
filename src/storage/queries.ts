import Dexie from "dexie";
import { State } from "ts-fsrs";
import { languageOfText } from "../domain/language";
import { db, searchTokens, type AppDatabase, type StoredWord } from "./db";
import {
  LESSON_MATES_RADIUS,
  programmeOrder,
  type CardFacts,
  type PlanLesson,
  type SessionSource,
} from "../domain/learning";
import { unitKey, wordKeyOf, wordRef } from "../domain/refs";
import { deviceTimezone } from "../domain/time";
import {
  byTime,
  emptyStats,
  emptySkills,
  foldStats,
  succeeded,
  summarizeEvents,
  type DaySummary,
} from "../domain/skills";
import { cardLabel, lessonProgress, type LessonProgress, type StatsSource } from "../domain/stats";
import {
  CARD_KINDS,
  fillSettings,
  type CardKind,
  type Course,
  type LearningRef,
  type LearningState,
  type Lesson,
  type LessonItem,
  type Phrase,
  type SessionCard,
  type Word,
} from "../domain/types";

const span = (first: string) =>
  [
    [first, Dexie.minKey],
    [first, Dexie.maxKey],
  ] as const;

export const loadSettings = async (database: AppDatabase = db) => fillSettings(await database.settings.get("settings"));
export const loadLessons = (database: AppDatabase = db) => database.lessons.toArray();
/** Курс один: тот, из которого модули программы, а без модулей — первый курс каталога. */
export async function currentCourse(database: AppDatabase = db): Promise<Course | undefined> {
  const module = await database.modules.toCollection().first();
  if (module) return database.courses.get(module.courseId);
  return database.courses.toCollection().first();
}
/** Уроки — источник новых карточек: пройденные и начатые, где выполнено хотя бы одно задание. */
export async function studiedLessons(database: AppDatabase = db): Promise<PlanLesson[]> {
  // Булево поле IndexedDB не индексирует, а уроков — десятки.
  const [lessons, rows] = await Promise.all([
    database.lessons.toArray(),
    database.blockProgress.filter((row) => row.done).toArray(),
  ]);
  const started = new Set(rows.map((row) => row.lessonId));
  const done = lessons.filter((lesson) => lesson.completed || started.has(lesson.id));
  if (!done.length) return [];
  const [modules, entries] = await Promise.all([
    database.modules.orderBy("number").toArray(),
    database.catalog.bulkGet(done.map((lesson) => lesson.id)),
  ]);
  const catalog = new Map(done.map((lesson, index) => [lesson.id, entries[index]?.position]));
  return programmeOrder(done, modules, (id) => catalog.get(id));
}
/** Связи урока в авторском порядке: по индексу, без чтения карточек. */
export const lessonItems = (lessonId: string, database: AppDatabase = db): Promise<LessonItem[]> =>
  database.lessonItems
    .where("[lessonId+position]")
    .between(...span(lessonId))
    .toArray();
const byKind = (refs: LearningRef[]) => {
  const groups: Record<CardKind, string[]> = { word: [], phrase: [] };
  for (const ref of refs) groups[ref.kind]?.push(ref.id);
  return groups;
};
/** Ключи существующих карточек: только ключи индексов, записи с текстами не читаются. */
export async function liveKeys(refs: LearningRef[], database: AppDatabase = db): Promise<Set<string>> {
  if (!refs.length) return new Set();
  const groups = byKind(refs);
  const live = new Set<string>();
  const tables = { word: database.words, phrase: database.phrases } as const;
  for (const kind of CARD_KINDS) {
    if (!groups[kind].length) continue;
    for (const id of await tables[kind].where("id").anyOf(groups[kind]).primaryKeys()) live.add(unitKey({ kind, id }));
  }
  return live;
}
export const statesOf = async (refs: LearningRef[], database: AppDatabase = db) =>
  new Map(
    (await database.cardStates.bulkGet(refs.map(unitKey)))
      .filter((s): s is LearningState => !!s)
      .map((s) => [s.unitKey, s]),
  );
export const liveWords = async (ids: string[], database: AppDatabase = db): Promise<StoredWord[]> =>
  (await database.words.bulkGet(ids)).filter((w): w is StoredWord => !!w);
export const livePhrases = async (ids: string[], database: AppDatabase = db): Promise<Phrase[]> =>
  (await database.phrases.bulkGet(ids)).filter((p): p is Phrase => !!p);
/** Полное содержимое перечисленных карточек; читаются только они. */
export async function cardsOf(refs: LearningRef[], database: AppDatabase = db): Promise<Map<string, SessionCard>> {
  const groups = byKind(refs);
  const cards = new Map<string, SessionCard>();
  if (groups.word.length)
    for (const word of await liveWords(groups.word, database)) cards.set(wordKeyOf(word.id), { kind: "word", word });
  if (groups.phrase.length)
    for (const phrase of await livePhrases(groups.phrase, database))
      cards.set(unitKey({ kind: "phrase", id: phrase.id }), { kind: "phrase", phrase });
  return cards;
}

export function dexieSource(database: AppDatabase = db): SessionSource & StatsSource {
  return {
    timezone: deviceTimezone,
    studiedLessons: () => studiedLessons(database),
    itemsOf: (lessonIds) =>
      lessonIds.length ? database.lessonItems.where("lessonId").anyOf(lessonIds).toArray() : Promise.resolve([]),
    lessonRefs: async (lessonId) => (await lessonItems(lessonId, database)).map((item) => item.ref),
    statesOf: (refs) => statesOf(refs, database),
    liveKeys: (refs) => liveKeys(refs, database),
    dueStates: (now) => database.cardStates.where("card.due").belowOrEqual(now).toArray(),
    factsOf: async (refs) => {
      const facts = new Map<string, CardFacts>();
      const groups = byKind(refs);
      for (const id of groups.word) facts.set(wordKeyOf(id), { kind: "word" });
      // Признаки фразы лежат в её записи; читаются только записи кандидатов, а не таблица целиком.
      if (groups.phrase.length)
        for (const phrase of await livePhrases(groups.phrase, database))
          facts.set(unitKey({ kind: "phrase", id: phrase.id }), {
            kind: "phrase",
            hasTranslation: !!phrase.translation,
            hasAudio: !!phrase.audioAssetId,
            language: languageOfText(phrase.text).code,
          });
      return facts;
    },
    phraseCount: () => database.phrases.count(),
    cardsOf: (refs) => cardsOf(refs, database),
    skillsOf: async (card) => {
      const key = unitKey(card.kind === "word" ? wordRef(card.word.id) : { kind: "phrase", id: card.phrase.id });
      const base = await database.baseSummary.get("base");
      // Без базы сводка считается по всей локальной истории.
      if (!base)
        return summarizeEvents(
          key,
          await database.events
            .where("[unitKey+createdAt]")
            .between(...span(key))
            .toArray(),
        );
      const row = await database.cardSkills.get(key);
      return summarizeEvents(key, await eventsAfter(database, key, base.asOf), row?.skills ?? emptySkills());
    },
    optionPool: (want) => optionPool(want, database),
    lessonMatesOf: (wordIds) => lessonMates(wordIds, database),
    phrasePool: (want) => phrasePool(want, database),
    daysBetween: async (from, to) => {
      const base = await database.baseSummary.get("base");
      const local = await database.events.where("localDate").between(from, to, true, true).toArray();
      const fresh = base ? local.filter((event) => event.createdAt > base.asOf) : local;
      const start: DaySummary[] = (base?.stats.days ?? [])
        .filter((day) => day.date >= from && day.date <= to)
        .map((day) => ({ ...day, keys: [...day.keys] }));
      return byTime(fresh).reduce((summary, event) => foldStats(summary, event, Infinity), {
        ...emptyStats(),
        days: start,
      }).days;
    },
    recentByType: async (type, limit) => {
      const base = await database.baseSummary.get("base");
      const range = base
        ? database.events.where("[type+createdAt]").between([type, base.asOf], [type, Dexie.maxKey], false, true)
        : database.events.where("[type+createdAt]").between(...span(type));
      const local = (await range.reverse().limit(limit).toArray()).reverse().map(succeeded);
      return [...(base?.stats.recentByType[type] ?? []), ...local].slice(-limit);
    },
    dueKeysBefore: (instant) => database.cardStates.where("card.due").below(instant).primaryKeys(),
    cardCount: async () => (await database.words.count()) + (await database.phrases.count()),
    eachState: (visit) => database.cardStates.each(visit),
    labelsOf: async (refs) =>
      new Map([...(await cardsOf(refs, database))].map(([key, card]) => [key, cardLabel(card)])),
    totals: async () => {
      const base = await database.baseSummary.get("base");
      const count = (keys: Iterable<string>) => {
        const byKind: Record<CardKind, number> = { word: 0, phrase: 0 };
        // Ключи снятых видов остаются в старых событиях: своего разряда у них нет, в число карточек они не идут.
        for (const key of keys) {
          const kind = (JSON.parse(key) as [CardKind, string])[0];
          if (kind in byKind) byKind[kind]++;
        }
        return { cards: byKind.word + byKind.phrase, byKind };
      };
      if (!base)
        return {
          answers: await database.events.count(),
          ...count((await database.events.orderBy("unitKey").uniqueKeys()) as string[]),
        };
      const fresh = await database.events.where("createdAt").above(base.asOf).toArray();
      const known = new Set(base.stats.answeredKeys);
      for (const event of fresh) known.add(event.unitKey);
      return { answers: base.stats.answers + fresh.length, ...count(known) };
    },
  };
}

/** События карточки строго после отсечки базы: включённые в базу ответы не учитываются второй раз. */
export const eventsAfter = (database: AppDatabase, unitKey: string, asOf: string) =>
  database.events.where("[unitKey+createdAt]").between([unitKey, asOf], [unitKey, Dexie.maxKey], false, true).toArray();

/**
 * Пул вариантов ответа. Маленький словарь берётся целиком в порядке идентификаторов, поэтому совпадает
 * с полным снимком; большой — несколькими случайными порциями без чтения всей таблицы.
 */
export async function optionPool(want: number, database: AppDatabase = db): Promise<Word[]> {
  const total = await database.words.count();
  if (total <= want) return database.words.toArray();
  const chunk = Math.ceil(want / 4);
  const seen = new Map<string, Word>();
  for (let draw = 0; draw < 8 && seen.size < want; draw++) {
    const offset = Math.floor(Math.random() * Math.max(1, total - chunk));
    for (const word of await database.words.orderBy("id").offset(offset).limit(chunk).toArray())
      seen.set(word.id, word);
  }
  return [...seen.values()];
}
/**
 * Соседи слов по урокам: слова не дальше `LESSON_MATES_RADIUS` позиций в каждом уроке слова. Позиции идут
 * с пропусками, а фразы занимают их наравне со словами, поэтому соседей бывает и меньше: окно ограничивает
 * чтение, а не обещает число слов. Читаются только ссылки окна и слова по id — не весь урок.
 */
export async function lessonMates(wordIds: string[], database: AppDatabase = db): Promise<Map<string, Word[]>> {
  const links = wordIds.length
    ? await database.lessonItems.where("unitKey").anyOf(wordIds.map(wordKeyOf)).toArray()
    : [];
  const windows = await Promise.all(
    links.map((link) =>
      database.lessonItems
        .where("[lessonId+position]")
        .between(
          [link.lessonId, link.position - LESSON_MATES_RADIUS],
          [link.lessonId, link.position + LESSON_MATES_RADIUS],
          true,
          true,
        )
        .toArray(),
    ),
  );
  const mateIds = new Map<string, Set<string>>();
  links.forEach((link, i) => {
    const ids = mateIds.get(link.ref.id) ?? new Set<string>();
    for (const item of windows[i]) if (item.ref.kind === "word" && item.ref.id !== link.ref.id) ids.add(item.ref.id);
    mateIds.set(link.ref.id, ids);
  });
  const all = [...new Set([...mateIds.values()].flatMap((ids) => [...ids]))];
  const live = new Map<string, Word>();
  for (const word of await database.words.bulkGet(all)) if (word) live.set(word.id, word);
  return new Map(
    wordIds.map((id) => [id, [...(mateIds.get(id) ?? [])].flatMap((mate) => live.get(mate) ?? [])] as const),
  );
}
/** Пул фраз для вариантов: те же правила, что у слов, — целиком для маленькой таблицы, порциями для большой. */
export async function phrasePool(want: number, database: AppDatabase = db): Promise<Phrase[]> {
  const total = await database.phrases.count();
  if (total <= want) return database.phrases.toArray();
  const chunk = Math.ceil(want / 4);
  const seen = new Map<string, Phrase>();
  for (let draw = 0; draw < 8 && seen.size < want; draw++) {
    const offset = Math.floor(Math.random() * Math.max(1, total - chunk));
    for (const phrase of await database.phrases.orderBy("id").offset(offset).limit(chunk).toArray())
      seen.set(phrase.id, phrase);
  }
  return [...seen.values()];
}

/** `cardCount` — живые карточки всех видов; `wordCount` и другие счётчики — по видам для подписей состава. */
export interface LessonView extends Lesson {
  cardCount: number;
  wordCount: number;
  phraseCount: number;
  progress?: LessonProgress;
}
/** С прогрессом состояния карточек урока читаются один раз здесь, по ключам связей; экраны получают группы готовыми. */
export async function lessonViews(database: AppDatabase = db, withProgress = false): Promise<LessonView[]> {
  const lessons = await loadLessons(database);
  return Promise.all(
    lessons.map(async (lesson) => {
      const links = await lessonItems(lesson.id, database);
      const tally = (items: LessonItem[]) => ({
        cardCount: items.length,
        wordCount: items.filter((i) => i.ref.kind === "word").length,
        phraseCount: items.filter((i) => i.ref.kind === "phrase").length,
      });
      const view: LessonView = { ...lesson, ...tally(links) };
      if (withProgress) {
        const refs = links.map((link) => link.ref);
        const [live, states] = await Promise.all([liveKeys(refs, database), statesOf(refs, database)]);
        const alive = links.filter((link) => live.has(link.unitKey));
        Object.assign(view, tally(alive));
        view.progress = lessonProgress(
          alive.map((link) => link.unitKey),
          states,
        );
      }
      return view;
    }),
  );
}
export async function lessonsOfCard(ref: LearningRef, database: AppDatabase = db): Promise<Lesson[]> {
  const links = await database.lessonItems.where("unitKey").equals(unitKey(ref)).toArray();
  const lessons = await loadLessons(database);
  return lessons.filter((lesson) => links.some((link) => link.lessonId === lesson.id));
}
/** Урок целиком: связи в авторском порядке, живые карточки трёх видов и их состояния — одной выборкой на таблицу. */
export interface LessonDetail {
  lesson: Lesson;
  items: LessonItem[];
  cards: Map<string, SessionCard>;
  words: StoredWord[];
  phrases: Phrase[];
  states: Map<string, LearningState>;
}
export async function lessonDetail(id: string, database: AppDatabase = db): Promise<LessonDetail | null> {
  const lesson = (await loadLessons(database)).find((item) => item.id === id);
  if (!lesson) return null;
  const links = await lessonItems(id, database);
  const cards = await cardsOf(
    links.map((link) => link.ref),
    database,
  );
  const live = links.filter((link) => cards.has(link.unitKey));
  const pick = <T>(kind: CardKind, read: (card: SessionCard) => T) =>
    live.filter((link) => link.ref.kind === kind).map((link) => read(cards.get(link.unitKey)!));
  const only = <K extends SessionCard["kind"]>(card: SessionCard) => card as Extract<SessionCard, { kind: K }>;
  return {
    lesson,
    items: live,
    cards,
    words: pick("word", (card) => only<"word">(card).word as StoredWord),
    phrases: pick("phrase", (card) => only<"phrase">(card).phrase),
    states: await statesOf(
      live.map((link) => link.ref),
      database,
    ),
  };
}

export type WordGroup = "new" | "learning" | "review" | "solid";
export const stateGroup = (state: LearningState | undefined): WordGroup => {
  if (!state) return "new";
  if (state.card.state === State.Learning || state.card.state === State.Relearning) return "learning";
  return state.card.scheduled_days >= 21 ? "solid" : "review";
};
export async function searchWordIds(query: string, database: AppDatabase = db): Promise<string[]> {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const sets = await Promise.all(tokens.map((token) => database.words.where("tokens").startsWith(token).primaryKeys()));
  const [first, ...rest] = sets;
  const others = rest.map((set) => new Set(set));
  return [...new Set(first)].filter((id) => others.every((set) => set.has(id)));
}
