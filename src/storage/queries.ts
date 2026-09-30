import Dexie from "dexie";
import { State } from "ts-fsrs";
import { db, isStandardWord, searchTokens, type LexiDatabase, type StoredWord } from "./db";
import { addDays, LESSON_MATES_RADIUS, localDay, type CardFacts, type SessionSource } from "../domain/learning";
import { isShippedCard, unitKey, wordKeyOf, wordRef } from "../domain/refs";
import {
  byTime,
  emptyStats,
  emptySkills,
  foldStats,
  succeeded,
  summarizeEvents,
  type DaySummary,
} from "../domain/skills";
import { normalize, wordKey } from "../domain/import";
import { scheduleCourses } from "../domain/schedule";
import { cardLabel, lessonProgress, type LessonProgress, type StatsSource } from "../domain/stats";
import {
  CARD_KINDS,
  defaultSchedule,
  DEFAULT_NEW_ITEMS_PER_DAY,
  fillSettings,
  LOCAL_COURSE,
  type CardKind,
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
export const PAGE_SIZE = 50;

export const loadSettings = async (database: LexiDatabase = db) =>
  fillSettings(await database.settings.get("settings"));
/** Уроки с датами по расписанию: единственное место, где даты вычисляются для чтения. */
export const loadLessons = async (database: LexiDatabase = db) =>
  scheduleCourses(await database.lessons.toArray(), await database.courses.toArray());
/** Связи урока в авторском порядке: по индексу, без чтения карточек. */
export const lessonItems = (lessonId: string, database: LexiDatabase = db): Promise<LessonItem[]> =>
  database.lessonItems
    .where("[lessonId+position]")
    .between(...span(lessonId))
    .toArray();
/** Идентификаторы удалённых слов: нужны только скану словаря, остальные выборки работают с ключами карточек. */
const deletedWordIds = async (database: LexiDatabase = db) =>
  new Set(await database.words.where("deletedAt").above("").primaryKeys());
/** Ключи удалённых карточек всех видов: удалённых мало, множество дешевле точечных проверок. */
export async function deletedKeys(database: LexiDatabase = db): Promise<Set<string>> {
  const [words, phrases] = await Promise.all([
    database.words.where("deletedAt").above("").primaryKeys(),
    database.phrases.where("deletedAt").above("").primaryKeys(),
  ]);
  return new Set([...words.map(wordKeyOf), ...phrases.map((id) => unitKey({ kind: "phrase", id }))]);
}
const byKind = (refs: LearningRef[]) => {
  const groups: Record<CardKind, string[]> = { word: [], phrase: [] };
  for (const ref of refs) groups[ref.kind]?.push(ref.id);
  return groups;
};
/** Ключи существующих не удалённых карточек: только ключи индексов, записи с текстами не читаются. */
export async function liveKeys(refs: LearningRef[], database: LexiDatabase = db): Promise<Set<string>> {
  if (!refs.length) return new Set();
  const groups = byKind(refs);
  const live = new Set<string>();
  const tables = { word: database.words, phrase: database.phrases } as const;
  for (const kind of CARD_KINDS) {
    if (!groups[kind].length) continue;
    const [present, deleted] = await Promise.all([
      tables[kind].where("id").anyOf(groups[kind]).primaryKeys(),
      tables[kind].where("deletedAt").above("").primaryKeys(),
    ]);
    const gone = new Set(deleted);
    for (const id of present) if (!gone.has(id)) live.add(unitKey({ kind, id }));
  }
  return live;
}
export const statesOf = async (refs: LearningRef[], database: LexiDatabase = db) =>
  new Map(
    (await database.cardStates.bulkGet(refs.map(unitKey)))
      .filter((s): s is LearningState => !!s)
      .map((s) => [s.unitKey, s]),
  );
export const liveWords = async (ids: string[], database: LexiDatabase = db): Promise<StoredWord[]> =>
  (await database.words.bulkGet(ids)).filter((w): w is StoredWord => !!w && !w.deletedAt);
export const livePhrases = async (ids: string[], database: LexiDatabase = db): Promise<Phrase[]> =>
  (await database.phrases.bulkGet(ids)).filter((p): p is Phrase => !!p && !p.deletedAt);
/** Полное содержимое перечисленных карточек; читаются только они. */
export async function cardsOf(refs: LearningRef[], database: LexiDatabase = db): Promise<Map<string, SessionCard>> {
  const groups = byKind(refs);
  const cards = new Map<string, SessionCard>();
  if (groups.word.length)
    for (const word of await liveWords(groups.word, database)) cards.set(wordKeyOf(word.id), { kind: "word", word });
  if (groups.phrase.length)
    for (const phrase of await livePhrases(groups.phrase, database))
      cards.set(unitKey({ kind: "phrase", id: phrase.id }), { kind: "phrase", phrase });
  return cards;
}

export function dexieSource(database: LexiDatabase = db): SessionSource & StatsSource {
  return {
    settings: () => loadSettings(database),
    lessons: () => loadLessons(database),
    lessonRefs: async (lessonId) => (await lessonItems(lessonId, database)).map((item) => item.ref),
    courses: async () => {
      const rows = await database.courses.toArray();
      // База без курсов (старый профиль до первого запуска приложения) планируется как один локальный курс.
      return rows.length
        ? rows
        : [
            {
              id: LOCAL_COURSE,
              title: "Мои слова",
              origin: "local" as const,
              subscribed: true,
              schedule: defaultSchedule,
              newItemsPerDay: DEFAULT_NEW_ITEMS_PER_DAY,
              createdAt: "",
              updatedAt: "",
            },
          ];
    },
    introducedTodayByCourse: async (today, timezone) => {
      const rows = await database.cardStates
        .where("introducedAt")
        .between(`${addDays(today, -1)}T00:00:00.000Z`, `${addDays(today, 2)}T00:00:00.000Z`)
        .toArray();
      const keys = rows
        .filter((state) => localDay(new Date(state.introducedAt), timezone) === today)
        .map((state) => state.unitKey);
      const counts = new Map<string, number>();
      if (!keys.length) return counts;
      // Введённых за день немного — не больше суммы пределов, поэтому связи читаются точечно.
      const links = await database.lessonItems.where("unitKey").anyOf(keys).toArray();
      const lessons = new Map(
        (await database.lessons.bulkGet([...new Set(links.map((link) => link.lessonId))]))
          .filter(Boolean)
          .map((lesson) => [lesson!.id, lesson!.courseId ?? LOCAL_COURSE]),
      );
      for (const key of keys) {
        const owners = new Set(
          links.filter((link) => link.unitKey === key).map((link) => lessons.get(link.lessonId) ?? LOCAL_COURSE),
        );
        if (!owners.size) owners.add(LOCAL_COURSE);
        for (const courseId of owners) counts.set(courseId, (counts.get(courseId) ?? 0) + 1);
      }
      return counts;
    },
    statesOf: (refs) => statesOf(refs, database),
    liveKeys: (refs) => liveKeys(refs, database),
    dueStates: (now) => database.cardStates.where("card.due").belowOrEqual(now).toArray(),
    lessonBoundKeys: async (refs) =>
      new Set(
        refs.length
          ? (await database.lessonItems.where("unitKey").anyOf(refs.map(unitKey)).toArray()).map((link) => link.unitKey)
          : [],
      ),
    scanLiveWordIds: async (after, limit) => {
      const deleted = await deletedWordIds(database);
      let cursor = after;
      for (;;) {
        const keys = await database.words
          .where("id")
          .above(cursor ?? Dexie.minKey)
          .limit(limit)
          .primaryKeys();
        if (!keys.length) return [];
        const live = keys.filter((id) => !deleted.has(id));
        if (live.length) return live;
        cursor = keys[keys.length - 1];
      }
    },
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
          });
      return facts;
    },
    phraseCount: async () =>
      (await database.phrases.count()) - (await database.phrases.where("deletedAt").above("").count()),
    cardsOf: (refs) => cardsOf(refs, database),
    skillsOf: async (card) => {
      const key = unitKey(card.kind === "word" ? wordRef(card.word.id) : { kind: "phrase", id: card.phrase.id });
      const base = await database.baseSummary.get("base");
      // Без базы или для пользовательской карточки сводка считается по всей локальной истории.
      const standard = card.kind === "word" ? isStandardWord(card.word) : isShippedCard(card);
      if (!base || !standard)
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
    deletedKeys: () => deletedKeys(database),
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
export const eventsAfter = (database: LexiDatabase, unitKey: string, asOf: string) =>
  database.events.where("[unitKey+createdAt]").between([unitKey, asOf], [unitKey, Dexie.maxKey], false, true).toArray();

/**
 * Пул вариантов ответа. Маленький словарь берётся целиком в порядке идентификаторов, поэтому совпадает
 * с полным снимком; большой — несколькими случайными порциями без чтения всей таблицы.
 */
export async function optionPool(want: number, database: LexiDatabase = db): Promise<Word[]> {
  const total = await database.words.count();
  if (total <= want) return (await database.words.toArray()).filter((word) => !word.deletedAt);
  const chunk = Math.ceil(want / 4);
  const seen = new Map<string, Word>();
  for (let draw = 0; draw < 8 && seen.size < want; draw++) {
    const offset = Math.floor(Math.random() * Math.max(1, total - chunk));
    for (const word of await database.words.orderBy("id").offset(offset).limit(chunk).toArray())
      if (!word.deletedAt) seen.set(word.id, word);
  }
  return [...seen.values()];
}
/**
 * Соседи слов по урокам: слова не дальше `LESSON_MATES_RADIUS` позиций в каждом уроке слова. Позиции идут
 * с пропусками, а фразы занимают их наравне со словами, поэтому соседей бывает и меньше: окно ограничивает
 * чтение, а не обещает число слов. Читаются только ссылки окна и слова по id — не весь урок.
 */
export async function lessonMates(wordIds: string[], database: LexiDatabase = db): Promise<Map<string, Word[]>> {
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
  for (const word of await database.words.bulkGet(all)) if (word && !word.deletedAt) live.set(word.id, word);
  return new Map(
    wordIds.map((id) => [id, [...(mateIds.get(id) ?? [])].flatMap((mate) => live.get(mate) ?? [])] as const),
  );
}
/** Пул фраз для вариантов: те же правила, что у слов, — целиком для маленькой таблицы, порциями для большой. */
export async function phrasePool(want: number, database: LexiDatabase = db): Promise<Phrase[]> {
  const total = await database.phrases.count();
  if (total <= want) return (await database.phrases.toArray()).filter((phrase) => !phrase.deletedAt);
  const chunk = Math.ceil(want / 4);
  const seen = new Map<string, Phrase>();
  for (let draw = 0; draw < 8 && seen.size < want; draw++) {
    const offset = Math.floor(Math.random() * Math.max(1, total - chunk));
    for (const phrase of await database.phrases.orderBy("id").offset(offset).limit(chunk).toArray())
      if (!phrase.deletedAt) seen.set(phrase.id, phrase);
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
export async function lessonViews(database: LexiDatabase = db, withProgress = false): Promise<LessonView[]> {
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
export async function lessonsOfCard(ref: LearningRef, database: LexiDatabase = db): Promise<Lesson[]> {
  const links = await database.lessonItems.where("unitKey").equals(unitKey(ref)).toArray();
  const lessons = await loadLessons(database);
  return lessons.filter((lesson) => links.some((link) => link.lessonId === lesson.id));
}
export const lessonsOfWord = (wordId: string, database: LexiDatabase = db) => lessonsOfCard(wordRef(wordId), database);
/** Урок целиком: связи в авторском порядке, живые карточки трёх видов и их состояния — одной выборкой на таблицу. */
export interface LessonDetail {
  lesson: Lesson;
  items: LessonItem[];
  cards: Map<string, SessionCard>;
  words: StoredWord[];
  phrases: Phrase[];
  states: Map<string, LearningState>;
}
export async function lessonDetail(id: string, database: LexiDatabase = db): Promise<LessonDetail | null> {
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
export type WordFilter = "all" | WordGroup;
export const stateGroup = (state: LearningState | undefined): WordGroup => {
  if (!state) return "new";
  if (state.card.state === State.Learning || state.card.state === State.Relearning) return "learning";
  return state.card.scheduled_days >= 21 ? "solid" : "review";
};
export interface WordPageRequest {
  query: string;
  filter: WordFilter;
  lessonId: string | null;
  cursor: WordCursor | null;
  limit?: number;
}
/** Курсор устойчив к вставкам: для просмотра — последняя пара «ключ сортировки + id», для поиска и урока — смещение в списке идентификаторов. */
export type WordCursor = { kind: "browse"; sortKey: string; id: string } | { kind: "list"; offset: number };
export interface WordPage {
  items: { word: StoredWord; group: WordGroup }[];
  cursor: WordCursor | null;
  scope: "search" | "lesson" | "all";
}

export async function searchWordIds(query: string, database: LexiDatabase = db): Promise<string[]> {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const sets = await Promise.all(tokens.map((token) => database.words.where("tokens").startsWith(token).primaryKeys()));
  const [first, ...rest] = sets;
  const others = rest.map((set) => new Set(set));
  return [...new Set(first)].filter((id) => others.every((set) => set.has(id)));
}

/** Словарь остаётся словарём слов: страницы, поиск и фильтр урока читают только слова. */
export async function wordPage(
  { query, filter, lessonId, cursor, limit = PAGE_SIZE }: WordPageRequest,
  database: LexiDatabase = db,
): Promise<WordPage> {
  const items: WordPage["items"] = [];
  const groupsOf = async (words: (StoredWord | undefined)[]) => {
    const live = words.filter((w): w is StoredWord => !!w && !w.deletedAt);
    const states = await statesOf(
      live.map((w) => wordRef(w.id)),
      database,
    );
    return new Map(live.map((word) => [word.id, stateGroup(states.get(wordKeyOf(word.id)))]));
  };
  const wanted = (group: WordGroup) => filter === "all" || group === filter;
  if (query.trim() || lessonId) {
    const ids = lessonId
      ? (await lessonItems(lessonId, database))
          .filter((link) => link.ref.kind === "word")
          .map((link) => link.ref.id)
          .filter(await matches(query, database))
      : await searchWordIds(query, database);
    let offset = cursor?.kind === "list" ? cursor.offset : 0,
      next: number | null = null;
    scan: while (offset < ids.length) {
      const slice = ids.slice(offset, offset + limit - items.length);
      const words = await database.words.bulkGet(slice);
      const groups = await groupsOf(words);
      for (let index = 0; index < slice.length; index++) {
        const word = words[index],
          group = word && groups.get(word.id);
        if (!word || !group || !wanted(group)) continue;
        items.push({ word, group });
        if (items.length === limit) {
          next = offset + index + 1;
          break scan;
        }
      }
      offset += slice.length;
    }
    return {
      items,
      cursor: next !== null && next < ids.length ? { kind: "list", offset: next } : null,
      scope: lessonId ? "lesson" : "search",
    };
  }
  let last = cursor?.kind === "browse" ? cursor : null;
  for (;;) {
    const range = last
      ? database.words.where("[sortKey+id]").above([last.sortKey, last.id])
      : database.words.orderBy("[sortKey+id]");
    const chunk = await range.limit(limit - items.length).toArray(); // дочитывается только недостающее
    if (!chunk.length) return { items, cursor: null, scope: "all" };
    const groups = await groupsOf(chunk);
    for (const word of chunk) {
      const group = groups.get(word.id);
      last = { kind: "browse", sortKey: word.sortKey, id: word.id };
      if (!group || !wanted(group)) continue;
      items.push({ word, group });
      if (items.length === limit) return { items, cursor: last, scope: "all" };
    }
  }
}
async function matches(query: string, database: LexiDatabase) {
  if (!query.trim()) return () => true;
  const found = new Set(await searchWordIds(query, database));
  return (id: string) => found.has(id);
}

export async function importPreview(
  rows: { greek: string; russian: string }[],
  database: LexiDatabase = db,
): Promise<{ duplicates: number; conflicts: number }> {
  let duplicates = 0,
    conflicts = 0;
  for (const row of rows) {
    if (
      await database.words
        .where("key")
        .equals(wordKey(row.greek, row.russian))
        .filter((word) => !word.deletedAt)
        .count()
    ) {
      duplicates++;
      continue;
    }
    if (
      await database.words
        .where("greekKey")
        .equals(normalize(row.greek))
        .filter((word) => !word.deletedAt)
        .count()
    )
      conflicts++;
  }
  return { duplicates, conflicts };
}
