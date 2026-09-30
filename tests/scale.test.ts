import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
import { indexWord, LexiDatabase } from "../src/storage/db";
import { dexieSource, lessonViews, searchWordIds, wordPage } from "../src/storage/queries";
import { makePlan, makeSession } from "../src/domain/learning";
import { progress } from "../src/domain/stats";
import { parseCatalog, SCHEMA_VERSION, type CatalogEntry } from "../src/content/schema";
import { refreshCatalog } from "../src/content/client";
import { submitAnswer } from "../src/storage/ops";
import { defaultSettings, type LearningState, type ReviewEvent, type Word } from "../src/domain/types";
import { itemOfLink, wordEvent, wordState } from "./helpers/cards";

/**
 * Большая локальная база: 100 000 слов, 20 000 состояний, 60 000 ответов.
 * Счётчики `reading` показывают, сколько записей каждой таблицы прочитал запрос — экраны не должны читать таблицы целиком.
 */
const WORDS = 100_000,
  STATES = 20_000,
  EVENTS = 60_000,
  LESSONS = 200;
const now = new Date("2026-09-15T09:00:00Z");
const iso = now.toISOString();
let db: LexiDatabase;
const reads: Record<string, number> = {};
const track = () => {
  for (const key of Object.keys(reads)) reads[key] = 0;
};
const pad = (index: number) => String(index).padStart(6, "0");

beforeAll(async () => {
  await new LexiDatabase("lexi-scale").delete();
  db = new LexiDatabase("lexi-scale");
  await db.open();
  for (const table of db.tables) {
    reads[table.name] = 0;
    table.hook("reading", (obj) => {
      reads[table.name]++;
      return obj;
    });
  }
  const chunk = 5000;
  for (let start = 0; start < WORDS; start += chunk) {
    const words: Word[] = Array.from({ length: Math.min(chunk, WORDS - start) }, (_, i) => {
      const index = start + i;
      return {
        id: `w${pad(index)}`,
        greek: `το λέξη${index}`,
        russian: `слово${index}`,
        ipa: "",
        segments: [],
        examples: [],
        verified: false,
        createdAt: iso,
        updatedAt: iso,
        ...(index % 97 === 0 ? { deletedAt: iso } : {}),
      };
    });
    await db.words.bulkAdd(words.map(indexWord));
  }
  const states: LearningState[] = Array.from({ length: STATES }, (_, i) =>
    wordState(`w${pad(i * 5)}`, {
      introducedAt: i < 3 ? iso : "2026-09-01T09:00:00Z",
      version: 1,
      card: {
        ...createEmptyCard(new Date("2026-09-01")),
        due: new Date(i % 3 ? "2026-09-14T08:00:00Z" : "2026-09-20T08:00:00Z"),
        state: i % 7 === 0 ? State.Relearning : State.Review,
        scheduled_days: i % 2 ? 3 : 30,
        reps: 2,
      },
    }),
  );
  await db.cardStates.bulkAdd(states);
  for (let start = 0; start < EVENTS; start += chunk) {
    const events: ReviewEvent[] = Array.from({ length: Math.min(chunk, EVENTS - start) }, (_, i) => {
      const index = start + i;
      const day = 1 + (index % 14);
      const at = `2026-09-${String(day).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`;
      return wordEvent(`w${pad((index % STATES) * 5)}`, {
        id: `e${pad(index)}`,
        sessionId: `s${index % 500}`,
        itemId: `i${index}`,
        snapshot: { greek: "", russian: "" },
        type: (["recognition", "assembly", "spelling", "listening"] as const)[index % 4],
        mode: "scheduled",
        rating: index % 5 ? 3 : 1,
        correct: index % 5 !== 0,
        answer: "",
        createdAt: at,
        localDate: at.slice(0, 10),
        responseTimeMs: 900,
      });
    });
    await db.events.bulkAdd(events);
  }
  await db.lessons.bulkAdd(
    Array.from({ length: LESSONS }, (_, i) => ({
      id: `lesson-${pad(i)}`,
      title: `Урок ${i}`,
      targetDate: i < 3 ? `2026-09-${17 + i}` : null,
      status: "upcoming" as const,
      createdAt: iso,
      updatedAt: iso,
    })),
  );
  await db.lessonItems.bulkAdd(
    Array.from({ length: LESSONS * 35 }, (_, i) =>
      itemOfLink({ lessonId: `lesson-${pad(Math.floor(i / 35))}`, wordId: `w${pad(i * 3)}`, position: i % 35 }),
    ),
  );
  // Смешанный урок на той же базе: фразы и пропуски в отдельных таблицах, связи типизированы.
  const at = iso,
    provenance = { sourceLabel: "тест", operation: "verbatim" as const };
  await db.phrases.bulkAdd(
    Array.from({ length: 500 }, (_, i) => ({
      id: `p${pad(i)}`,
      text: `Φράση ${i}.`,
      translation: `Фраза ${i}.`,
      provenance,
      createdAt: at,
      updatedAt: at,
    })),
  );
  await db.lessons.add({
    id: "lesson-mixed",
    title: "Смешанный",
    targetDate: "2026-09-16",
    status: "upcoming",
    createdAt: iso,
    updatedAt: iso,
  });
  const mixedRefs = Array.from({ length: 35 }, (_, i) =>
    i % 3 === 2 ? { kind: "word" as const, id: `w${pad(i * 7 + 1)}` } : { kind: "phrase" as const, id: `p${pad(i)}` },
  );
  await db.lessonItems.bulkAdd(
    mixedRefs.map((ref, position) => ({
      lessonId: "lesson-mixed",
      unitKey: JSON.stringify([ref.kind, ref.id]),
      ref,
      position,
    })),
  );
  await db.settings.put({ ...defaultSettings, sessionSize: 20 });
  await db.courses.put({
    id: "my",
    title: "Мои слова",
    origin: "local",
    subscribed: true,
    schedule: { startDate: null, weekdays: [], lessonHour: 12 },
    newItemsPerDay: 10,
    createdAt: iso,
    updatedAt: iso,
  });
}, 180_000);
afterAll(() => db.close());

describe("ограниченные выборки на большой базе", () => {
  it("первая страница словаря читает не больше 50 карточек и ни одной записи истории", async () => {
    track();
    const page = await wordPage({ query: "", filter: "all", lessonId: null, cursor: null }, db);
    expect(page.items).toHaveLength(50);
    expect(reads.words).toBeLessThanOrEqual(52);
    expect(reads.events).toBe(0);
    expect(reads.sessions).toBe(0);
    track();
    const next = await wordPage({ query: "", filter: "all", lessonId: null, cursor: page.cursor }, db);
    expect(next.items[0].word.id).not.toBe(page.items[0].word.id);
    expect(reads.words).toBeLessThanOrEqual(52);
  }, 60_000);
  it("поиск по префиксу читает только совпавшие карточки страницы", async () => {
    track();
    const ids = await searchWordIds("λεξη123", db);
    expect(ids.length).toBeGreaterThan(50);
    expect(reads.words).toBe(0); // только ключи индекса
    const page = await wordPage({ query: "λεξη123", filter: "all", lessonId: null, cursor: null }, db);
    expect(page.items).toHaveLength(50);
    expect(reads.words).toBeLessThanOrEqual(52);
  }, 60_000);
  it("план дня не читает таблицы слов, событий и сессий, а состояния — только по индексам и ключам; тексты новых видов — только признаки кандидатов", async () => {
    track();
    const plan = await makePlan(dexieSource(db), now);
    expect(plan.introducedToday).toBe(3);
    expect(plan.newRefs).toHaveLength(7);
    expect(plan.newRefs.some((ref) => ref.kind !== "word")).toBe(true); // смешанный урок с ближайшим сроком идёт первым
    expect(plan.reviews.length).toBeGreaterThan(1000);
    expect(plan.deadlines).toHaveLength(4);
    expect(reads.words).toBe(0);
    expect(reads.events).toBe(0);
    expect(reads.sessions).toBe(0);
    expect(reads.cardStates).toBeLessThan(STATES);
    expect(reads.phrases).toBeLessThanOrEqual(24); // только фразы-кандидаты урока, не таблица целиком
  }, 60_000);
  it("сессия загружает полные карточки только для своих карточек и пула вариантов, историю — только своих карточек", async () => {
    track();
    const session = await makeSession({ source: dexieSource(db), now, random: () => 0.37 });
    expect(session.items).toHaveLength(20);
    expect(reads.words).toBeLessThanOrEqual(20 + 48 * 2);
    expect(reads.phrases).toBeLessThanOrEqual(20 + 48 * 2 + 24); // выбранные фразы, пул вариантов и признаки кандидатов
    const reviewed = session.items.filter((item) => !item.isNew).length;
    expect(reads.events).toBeLessThanOrEqual(reviewed * Math.ceil(EVENTS / STATES) + reviewed);
    expect(reads.sessions).toBe(0);
    await db.sessions.add(session);
    track();
    await submitAnswer({
      session,
      item: session.items[0],
      correct: true,
      answer: "",
      responseTimeMs: 800,
      activeTimeMs: 800,
      timezone: "Asia/Nicosia",
      now,
      database: db,
    });
    expect(reads.words).toBe(0);
    expect(reads.events).toBeLessThanOrEqual(1);
    expect(reads.cardStates).toBeLessThanOrEqual(1);
    expect(reads.sessions).toBe(1);
  }, 60_000);
  it("статистика читает события периода и агрегаты, а не всю историю и словарь", async () => {
    track();
    const stats = await progress(dexieSource(db), now);
    expect(stats.totals.answers).toBe(EVENTS + 1);
    expect(stats.days).toHaveLength(7);
    expect(reads.words).toBe(0);
    expect(reads.events).toBeLessThan(EVENTS / 2 + 50);
    expect(reads.sessions).toBe(0);
  }, 60_000);
  it("список уроков с прогрессом читает связи и по одному состоянию на связь, а не карточки любого вида", async () => {
    track();
    const views = await lessonViews(db, true);
    expect(views).toHaveLength(LESSONS + 1);
    expect(views.find((view) => view.id === "lesson-mixed")).toMatchObject({
      cardCount: 35,
      phraseCount: 24,
      wordCount: 11,
    });
    expect(reads.phrases).toBe(0);
    expect(
      views.every((view) => view.progress!.solid + view.progress!.review + view.progress!.fresh === view.cardCount),
    ).toBe(true);
    expect(reads.words).toBe(0);
    expect(reads.events).toBe(0);
    expect(reads.cardStates).toBeLessThanOrEqual((LESSONS + 1) * 35);
  }, 60_000);
  it("каталог на 100 000 слов читается одним запросом и не создаёт ни слов, ни прогресса", async () => {
    const lessons: CatalogEntry[] = Array.from({ length: 3000 }, (_, i) => ({
      id: `cat-${pad(i)}`,
      courseId: "big",
      language: "el",
      title: `Урок ${i}`,
      wordCount: 34,
      phraseCount: 0,
      cardCount: 34,
      version: `v${i}`,
      url: `content/packages/cat-${pad(i)}@v${i}.json`,
      bytes: 40000,
      media: { count: 34, bytes: 20000 },
    }));
    const catalog = parseCatalog({ schemaVersion: SCHEMA_VERSION, generatedAt: iso, lessons });
    expect(catalog.lessons.reduce((sum, l) => sum + l.wordCount, 0)).toBeGreaterThanOrEqual(100_000);
    const requests: string[] = [];
    const before = await db.words.count();
    await refreshCatalog(db, {
      json: async (url) => {
        requests.push(url);
        return catalog;
      },
      blob: async () => {
        throw new Error("медиа не запрашивается");
      },
    });
    expect(requests).toEqual(["content/catalog.json"]);
    expect(await db.catalog.count()).toBe(3000);
    expect(await db.words.count()).toBe(before);
    expect(await db.packages.count()).toBe(0);
  }, 60_000);
});
