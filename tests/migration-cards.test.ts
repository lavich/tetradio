import "fake-indexeddb/auto";
import "./helpers/self";
import Dexie from "dexie";
import { createEmptyCard, State } from "ts-fsrs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEGACY_CREATED, LexiDatabase, SCHEMA_VERSION } from "../src/storage/db";
import { exportFull, exportWordsTsv, inspectBackup, restoreBackup } from "../src/features/backup/backup";
import { lessonItems } from "../src/storage/queries";
import { makeSession } from "../src/domain/learning";
import { dexieSource } from "../src/storage/queries";
import { submitAnswer } from "../src/storage/ops";
import { applyPackage } from "../src/content/client";
import { phraseRevisionOf } from "../content/build";
import { unitKey, wordKeyOf, wordRef } from "./helpers/cards";
import { content, wordsOf } from "./helpers/content";
import { buildMixed, installMixed, MIXED_LESSON, MIXED_PHRASES, mixedPackage } from "./helpers/mixed";

/**
 * Схема 5: так выглядит база пользователя перед переходом к карточкам трёх видов. Индексы повторяют
 * версии 1–5 приложения; данные — словарные ключи, события с `wordId`, сессия со `wordId`/`word` и `introducedWordIds`.
 */
class V5Database extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(5).stores({
      words: "id,greek,russian,deletedAt,key,greekKey,[sortKey+id],*tokens",
      lessons: "id,targetDate,status,courseId",
      lessonWords: "[lessonId+wordId],wordId,[lessonId+position]",
      courses: "id,origin",
      assets: "id,kind",
      media: "id",
      packages: "lessonId",
      catalog: "id,courseId",
      states: "wordId,introducedAt,card.due",
      events: "id,wordId,sessionId,localDate,type,createdAt,[wordId+createdAt],[type+createdAt]",
      sessions: "id,planDate,status,[status+createdAt]",
      settings: "id",
      meta: "key",
      baseSkills: "wordId",
      baseSummary: "id",
      syncVersions: "id,createdAt",
      syncStash: "wordId",
    });
  }
}
const NAME = "lexi-cards-migrate";
const iso = "2026-09-16T09:00:00.000Z";
const card = (due: string, days = 3) => ({
  ...createEmptyCard(new Date("2026-09-01")),
  due: new Date(due),
  state: State.Review,
  scheduled_days: days,
  reps: 2,
});

/** Профиль схемы 5: два урока, правка и удаление, история, база синхронизации, отложенное состояние и активная сессия с пройденным знакомством. */
async function seedV5() {
  const legacy = new V5Database(NAME);
  await legacy.open();
  const l12 = wordsOf("lesson-1-2");
  const stored = (word: (typeof l12)[number], over: Record<string, unknown> = {}) => ({
    ...word,
    createdAt: LEGACY_CREATED,
    updatedAt: LEGACY_CREATED,
    key: "",
    greekKey: "",
    sortKey: "",
    tokens: [],
    ...over,
  });
  await legacy.table("words").bulkAdd([
    ...l12.map((w) => stored(w)),
    stored({ ...l12[0], id: "w-own", greek: "η καρέκλα", russian: "стул", revision: undefined } as never, {
      createdAt: iso,
      updatedAt: iso,
    }),
  ]);
  await legacy.table("words").update("w12-01", { russian: "моя правка", edited: true, updatedAt: iso });
  await legacy.table("words").update("w12-02", { deletedAt: iso });
  await legacy.table("courses").bulkAdd([
    {
      id: "my",
      title: "Мои слова",
      origin: "local",
      subscribed: true,
      schedule: { startDate: null, weekdays: [] },
      newWordsPerDay: 7,
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: "leeke",
      title: "Греческий A2",
      origin: "content",
      subscribed: true,
      schedule: { startDate: "2026-09-14", weekdays: [1, 4] },
      newWordsPerDay: 12,
      createdAt: iso,
      updatedAt: iso,
    },
  ]);
  await legacy.table("lessons").bulkAdd([
    {
      id: "lesson-1-2",
      courseId: "leeke",
      title: "Урок 1.2",
      targetDate: "2026-09-18",
      status: "upcoming",
      createdAt: LEGACY_CREATED,
      updatedAt: LEGACY_CREATED,
    },
    {
      id: "lesson-own",
      courseId: "my",
      title: "Свой набор",
      targetDate: null,
      status: "upcoming",
      createdAt: iso,
      updatedAt: iso,
    },
  ]);
  await legacy
    .table("lessonWords")
    .bulkAdd([
      ...l12.map((w, position) => ({ lessonId: "lesson-1-2", wordId: w.id, position })),
      { lessonId: "lesson-own", wordId: "w-own", position: 0 },
      { lessonId: "lesson-own", wordId: "w12-16", position: 1 },
    ]);
  await legacy.table("assets").add({
    id: "img-w12-16",
    kind: "image",
    blob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: "image/svg+xml" }),
    mimeType: "image/svg+xml",
    source: "тест",
    alt: "",
  });
  await legacy.table("media").add({
    id: "img-w12-16",
    kind: "image",
    mimeType: "image/svg+xml",
    url: "content/media/img-w12-16@x.svg",
    bytes: 10,
    version: "x",
    required: true,
    alt: "",
    source: "",
  });
  await legacy.table("packages").add({
    lessonId: "lesson-1-2",
    courseId: "leeke",
    version: "v-old",
    schemaVersion: 2,
    installedAt: iso,
    words: l12,
    media: [],
    removed: ["w12-03"],
  });
  await legacy.table("states").bulkAdd([
    { wordId: "w12-16", card: card("2026-09-14T08:00:00Z", 30), introducedAt: "2026-09-01T09:00:00Z", version: 4 },
    { wordId: "w12-05", card: card("2026-09-20T08:00:00Z", 3), introducedAt: "2026-09-10T09:00:00Z", version: 1 },
    { wordId: "w-own", card: card("2026-09-17T08:00:00Z", 1), introducedAt: "2026-09-15T09:00:00Z", version: 2 },
  ]);
  const word = (id: string) => ({
    ...l12.find((w) => w.id === id)!,
    createdAt: LEGACY_CREATED,
    updatedAt: LEGACY_CREATED,
  });
  await legacy.table("events").bulkAdd([
    {
      id: "e1",
      sessionId: "s-old",
      itemId: "i1",
      wordId: "w12-16",
      snapshot: { greek: "το σπίτι", russian: "дом" },
      type: "recognition",
      mode: "scheduled",
      rating: 3,
      correct: true,
      answer: "дом",
      createdAt: "2026-09-14T09:00:00Z",
      localDate: "2026-09-14",
      responseTimeMs: 900,
    },
    {
      id: "e-s-live-0",
      sessionId: "s-live",
      itemId: "s-live-0",
      wordId: "w12-05",
      snapshot: { greek: "x", russian: "y" },
      type: "spelling",
      mode: "scheduled",
      rating: 1,
      correct: false,
      answer: "ошибка",
      createdAt: "2026-09-16T08:00:00Z",
      localDate: "2026-09-16",
      responseTimeMs: 1200,
    },
  ]);
  await legacy.table("sessions").bulkAdd([
    {
      id: "s-old",
      createdAt: "2026-09-14T09:00:00Z",
      planDate: "2026-09-14",
      items: [],
      index: 0,
      status: "done",
      activeTimeMs: 1000,
    },
    {
      id: "s-live",
      createdAt: "2026-09-16T08:00:00Z",
      planDate: "2026-09-16",
      index: 1,
      status: "active",
      activeTimeMs: 5000,
      objectiveVersion: 1,
      introducedWordIds: ["w12-07"],
      items: [
        {
          id: "s-live-0",
          wordId: "w12-05",
          word: word("w12-05"),
          type: "spelling",
          options: [],
          isNew: false,
          mode: "scheduled",
          expectedVersion: 0,
          eventId: "e-s-live-0",
        },
        {
          id: "s-live-1",
          wordId: "w12-07",
          word: word("w12-07"),
          type: "recognition",
          options: ["a", "b", "c", "d"],
          isNew: true,
          mode: "scheduled",
          expectedVersion: 0,
        },
        {
          id: "s-live-0-retry",
          wordId: "w12-05",
          word: word("w12-05"),
          type: "spelling",
          options: [],
          isNew: false,
          mode: "practice",
          expectedVersion: 1,
          retryOf: "s-live-0",
        },
      ],
    },
  ]);
  await legacy.table("settings").add({ id: "settings", timezone: "Asia/Nicosia", sessionSize: 12, errorReports: true });
  await legacy.table("baseSkills").add({
    wordId: "w12-16",
    skills: {
      types: { recognition: { recent: [true], lastAt: "2026-09-14T09:00:00Z" } },
      lastTypes: ["recognition"],
      cleanAssemblies: 0,
    },
  });
  await legacy.table("baseSummary").add({
    id: "base",
    asOf: "2026-09-14T10:00:00Z",
    versionId: "dev-1",
    stats: {
      days: [{ date: "2026-09-14", answers: 1, wordIds: ["w12-16"] }],
      recentByType: { recognition: [true] },
      answers: 1,
      answeredWordIds: ["w12-16"],
    },
  });
  await legacy.table("syncStash").add({
    wordId: "w13-01",
    state: {
      wordId: "w13-01",
      card: { ...card("2026-09-19T08:00:00Z"), due: "2026-09-19T08:00:00.000Z" },
      introducedAt: "2026-09-12T09:00:00.000Z",
      version: 1,
    },
  });
  await legacy.table("meta").bulkAdd([
    { key: "sync:device", value: "dev" },
    { key: "app", value: "lexi:5" },
  ]);
  legacy.close();
}

beforeEach(async () => {
  await Dexie.delete(NAME);
});
afterEach(async () => {
  await Dexie.delete(NAME);
});

describe("переход профиля схемы 5 к карточкам трёх видов (без сети)", () => {
  it("копирует словарные ключи в типизированные хранилища: сроки, версии, порядок, правки, удаления и медиа совпадают", async () => {
    await seedV5();
    const db = new LexiDatabase(NAME);
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);
    // Состояния: тот же ID слова, те же даты FSRS и счётчики версий.
    const house = (await db.cardStates.get(wordKeyOf("w12-16")))!;
    expect(house).toMatchObject({ ref: wordRef("w12-16"), version: 4, introducedAt: "2026-09-01T09:00:00Z" });
    expect(new Date(house.card.due).toISOString()).toBe("2026-09-14T08:00:00.000Z");
    expect(house.card.scheduled_days).toBe(30);
    expect((await db.cardStates.get(wordKeyOf("w-own")))!.version).toBe(2);
    expect(await db.cardStates.count()).toBe(3);
    // Связи: порядок и принадлежность сохранены.
    expect((await lessonItems("lesson-1-2", db)).map((link) => link.ref.id)).toEqual(
      wordsOf("lesson-1-2").map((w) => w.id),
    );
    expect((await lessonItems("lesson-own", db)).map((link) => [link.ref.id, link.position])).toEqual([
      ["w-own", 0],
      ["w12-16", 1],
    ]);
    // Правка, удаление, медиа, курс и настройки — как были.
    expect(await db.words.get("w12-01")).toMatchObject({ russian: "моя правка", edited: true });
    expect((await db.words.get("w12-02"))!.deletedAt).toBeTruthy();
    expect(await db.assets.count()).toBe(1);
    expect(await db.media.count()).toBe(1);
    expect((await db.settings.get("settings"))!.sessionSize).toBe(12);
    // Предел слов стал пределом карточек с тем же числом.
    expect(await db.courses.get("my")).toMatchObject({ newItemsPerDay: 7 });
    expect(await db.courses.get("leeke")).toMatchObject({
      newItemsPerDay: 12,
      schedule: { startDate: "2026-09-14", weekdays: [1, 4] },
    });
    expect("newWordsPerDay" in (await db.courses.get("leeke"))!).toBe(false);
    // Пакет: убранная связь — ключ карточки, фразы пустые.
    expect(await db.packages.get("lesson-1-2")).toMatchObject({
      version: "v-old",
      removed: [wordKeyOf("w12-03")],
      phrases: [],
    });
    // Прежние хранилища пусты: данные скопированы, не продублированы.
    for (const table of [db.states, db.lessonWords, db.baseSkills, db.syncStash]) expect(await table.count()).toBe(0);
    db.close();
  });
  it("события, база навыков, сводка и отложенный прогресс получают ссылки без новых событий и фиктивного прогресса", async () => {
    await seedV5();
    const db = new LexiDatabase(NAME);
    await db.open();
    expect(await db.events.count()).toBe(2);
    const event = (await db.events.get("e1"))!;
    expect(event).toMatchObject({
      ref: wordRef("w12-16"),
      unitKey: wordKeyOf("w12-16"),
      snapshot: { greek: "το σπίτι", russian: "дом" },
      rating: 3,
    });
    expect("wordId" in event).toBe(false);
    expect(
      await db.events
        .where("[unitKey+createdAt]")
        .between([wordKeyOf("w12-16"), Dexie.minKey], [wordKeyOf("w12-16"), Dexie.maxKey])
        .count(),
    ).toBe(1);
    expect(await db.cardSkills.get(wordKeyOf("w12-16"))).toMatchObject({
      ref: wordRef("w12-16"),
      skills: { lastTypes: ["recognition"] },
    });
    expect((await db.baseSummary.get("base"))!.stats).toEqual({
      days: [{ date: "2026-09-14", answers: 1, keys: [wordKeyOf("w12-16")] }],
      recentByType: { recognition: [true] },
      answers: 1,
      answeredKeys: [wordKeyOf("w12-16")],
    });
    expect(await db.cardStash.get(wordKeyOf("w13-01"))).toMatchObject({
      ref: wordRef("w13-01"),
      state: { ref: wordRef("w13-01"), version: 1, introducedAt: "2026-09-12T09:00:00.000Z" },
    });
    expect(await db.meta.get("sync:device")).toEqual({ key: "sync:device", value: "dev" });
    db.close();
  });
  it("активная сессия продолжается с первого неотвеченного задания: ответы, знакомства и дополнительная попытка сохранены", async () => {
    await seedV5();
    const db = new LexiDatabase(NAME);
    await db.open();
    const session = (await db.sessions.get("s-live"))!;
    expect(session.status).toBe("active");
    expect(session.index).toBe(1);
    expect(session.introducedKeys).toEqual([wordKeyOf("w12-07")]);
    expect("introducedWordIds" in session).toBe(false);
    expect(
      session.items.map((item) => [item.unitKey, item.card.kind, item.eventId ?? null, item.retryOf ?? null]),
    ).toEqual([
      [wordKeyOf("w12-05"), "word", "e-s-live-0", null],
      [wordKeyOf("w12-07"), "word", null, null],
      [wordKeyOf("w12-05"), "word", null, "s-live-0"],
    ]);
    expect(session.items[1].card.kind === "word" && session.items[1].card.word.id).toBe("w12-07");
    expect("wordId" in session.items[0]).toBe(false);
    expect("word" in session.items[0]).toBe(false);
    // Первое неотвеченное — знакомое задание w12-07: ответ на w12-05 не запрашивается снова.
    expect(session.items.findIndex((item) => !item.eventId && !item.skipped)).toBe(1);
    // Ответ в перенесённой сессии пишется по типизированному ключу и не дублирует событие.
    const event = await submitAnswer({
      session,
      item: session.items[1],
      correct: true,
      answer: "",
      responseTimeMs: 500,
      activeTimeMs: 6000,
      timezone: "Asia/Nicosia",
      now: new Date("2026-09-16T09:00:00Z"),
      database: db,
    });
    expect(event).toMatchObject({
      ref: wordRef("w12-07"),
      unitKey: wordKeyOf("w12-07"),
      snapshot: { greek: expect.any(String) },
    });
    expect(await db.events.count()).toBe(3);
    expect((await db.cardStates.get(wordKeyOf("w12-07")))!.version).toBe(1);
    db.close();
  });
  it("повторное открытие мигрированной базы ничего не меняет", async () => {
    await seedV5();
    const first = new LexiDatabase(NAME);
    await first.open();
    const snapshot = async (db: LexiDatabase) => ({
      states: await db.cardStates.toArray(),
      items: await db.lessonItems.toArray(),
      events: await db.events.toArray(),
      sessions: await db.sessions.toArray(),
    });
    const before = await snapshot(first);
    first.close();
    const second = new LexiDatabase(NAME);
    await second.open();
    expect(await snapshot(second)).toEqual(before);
    second.close();
  });
});

/** Тестовая база называется иначе, а копия проверяется по имени базы приложения. */
const asLexi = (parsed: { data: { databaseName: string } }) =>
  new Blob([JSON.stringify({ ...parsed, data: { ...parsed.data, databaseName: "lexi" } })], {
    type: "application/json",
  });
const legacyWord = (id: string, greek: string, russian: string, over: Record<string, unknown> = {}) => ({
  id,
  greek,
  russian,
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: LEGACY_CREATED,
  updatedAt: LEGACY_CREATED,
  ...over,
});
/** Файл копии прежней версии: таблицы и строки в формате dexie-export-import. */
const SCHEMAS: Record<string, string> = {
  words: "id,greek,russian,deletedAt,key,greekKey,[sortKey+id],*tokens",
  lessons: "id,targetDate,status,courseId",
  lessonWords: "[lessonId+wordId],wordId,[lessonId+position]",
  courses: "id,origin",
  assets: "id,kind",
  media: "id",
  packages: "lessonId",
  states: "wordId,introducedAt,card.due",
  events: "id,wordId,sessionId,localDate,type,createdAt,[wordId+createdAt],[type+createdAt]",
  sessions: "id,planDate,status,[status+createdAt]",
  settings: "id",
  meta: "key",
  baseSkills: "wordId",
  baseSummary: "id",
  syncStash: "wordId",
};
function backupOf(version: number, tables: Record<string, unknown[]>) {
  return new Blob(
    [
      JSON.stringify({
        formatName: "dexie",
        formatVersion: 1,
        data: {
          databaseName: "lexi",
          databaseVersion: version,
          tables: Object.keys(tables).map((name) => ({ name, schema: SCHEMAS[name], rowCount: tables[name].length })),
          data: Object.entries(tables).map(([tableName, rows]) => ({ tableName, inbound: true, rows })),
        },
      }),
    ],
    { type: "application/json" },
  );
}
const stateRow = {
  wordId: "w12-16",
  card: card("2026-09-14T08:00:00Z", 30),
  introducedAt: "2026-09-01T09:00:00Z",
  version: 4,
};
const eventRow = {
  id: "e1",
  sessionId: "s",
  itemId: "i1",
  wordId: "w12-16",
  snapshot: { greek: "το σπίτι", russian: "дом" },
  type: "recognition",
  mode: "scheduled",
  rating: 3,
  correct: true,
  answer: "дом",
  createdAt: "2026-09-14T09:00:00Z",
  localDate: "2026-09-14",
  responseTimeMs: 900,
};
const V2_TABLES = {
  words: [legacyWord("w12-16", "το σπίτι", "дом"), legacyWord("w-own", "η καρέκλα", "стул")],
  lessons: [
    {
      id: "lesson-1-2",
      title: "Урок 1.2",
      targetDate: "2026-09-18",
      status: "upcoming",
      createdAt: LEGACY_CREATED,
      updatedAt: LEGACY_CREATED,
    },
  ],
  lessonWords: [
    { lessonId: "lesson-1-2", wordId: "w12-16", position: 0 },
    { lessonId: "lesson-1-2", wordId: "w-own", position: 1 },
  ],
  assets: [],
  media: [],
  packages: [
    {
      lessonId: "lesson-1-2",
      version: "legacy",
      schemaVersion: 0,
      installedAt: iso,
      words: [],
      media: [],
      removed: ["w-x"],
    },
  ],
  states: [stateRow],
  events: [eventRow],
  sessions: [],
  settings: [{ id: "settings", timezone: "Asia/Nicosia", newWordsPerDay: 9, sessionSize: 20 }],
  meta: [{ key: "app", value: "lexi:2" }],
};
const V3_TABLES = {
  ...V2_TABLES,
  meta: [{ key: "app", value: "lexi:3" }],
  baseSkills: [{ wordId: "w12-16", skills: { types: {}, lastTypes: ["recognition"], cleanAssemblies: 0 } }],
  baseSummary: [
    {
      id: "base",
      asOf: "2026-09-14T10:00:00Z",
      versionId: "v",
      stats: {
        days: [{ date: "2026-09-14", answers: 1, wordIds: ["w12-16"] }],
        recentByType: {},
        answers: 1,
        answeredWordIds: ["w12-16"],
      },
    },
  ],
  syncStash: [
    {
      wordId: "w13-01",
      state: {
        wordId: "w13-01",
        card: { ...card("2026-09-19T08:00:00Z"), due: "2026-09-19T08:00:00.000Z" },
        introducedAt: "2026-09-12T09:00:00.000Z",
        version: 1,
      },
    },
  ],
};
const V5_TABLES = {
  ...V3_TABLES,
  meta: [{ key: "app", value: "lexi:5" }],
  courses: [
    {
      id: "my",
      title: "Мои слова",
      origin: "local",
      subscribed: true,
      schedule: { startDate: null, weekdays: [] },
      newWordsPerDay: 4,
      createdAt: iso,
      updatedAt: iso,
    },
  ],
  lessons: [
    {
      id: "lesson-1-2",
      courseId: "my",
      title: "Урок 1.2",
      targetDate: "2026-09-18",
      status: "upcoming",
      createdAt: LEGACY_CREATED,
      updatedAt: LEGACY_CREATED,
    },
  ],
  settings: [{ id: "settings", timezone: "Asia/Nicosia", sessionSize: 20, errorReports: true }],
};

describe("полная копия: прежние версии и смешанный профиль", () => {
  let db: LexiDatabase;
  beforeEach(async () => {
    db = new LexiDatabase(NAME);
    await db.open();
  });
  afterEach(() => db.close());
  it.each([
    [2, V2_TABLES, 9],
    [3, V3_TABLES, 9],
    [5, V5_TABLES, 4],
  ] as const)(
    "копия схемы %i восстанавливается через ту же миграцию без требования новых таблиц",
    async (version, tables, perDay) => {
      const file = backupOf(version, tables as Record<string, unknown[]>);
      expect(await inspectBackup(file)).toMatchObject({ ok: true, report: { legacy: true } });
      await restoreBackup(file, db);
      expect((await lessonItems("lesson-1-2", db)).map((link) => link.ref.id)).toEqual(["w12-16", "w-own"]);
      expect(await db.cardStates.get(wordKeyOf("w12-16"))).toMatchObject({ ref: wordRef("w12-16"), version: 4 });
      expect(await db.events.get("e1")).toMatchObject({ ref: wordRef("w12-16"), unitKey: wordKeyOf("w12-16") });
      expect((await db.courses.get("my"))!.newItemsPerDay).toBe(perDay);
      expect((await db.packages.get("lesson-1-2"))!.removed).toEqual([wordKeyOf("w-x")]);
      if (version >= 3) {
        expect(await db.cardSkills.get(wordKeyOf("w12-16"))).toBeTruthy();
        expect((await db.baseSummary.get("base"))!.stats.answeredKeys).toEqual([wordKeyOf("w12-16")]);
        expect(await db.cardStash.get(wordKeyOf("w13-01"))).toMatchObject({ ref: wordRef("w13-01") });
      }
      for (const table of [db.states, db.lessonWords, db.baseSkills, db.syncStash]) expect(await table.count()).toBe(0);
    },
  );
  it("смешанный профиль с активной сессией переносится целиком, снимки заданий совпадают", async () => {
    await installMixed(db);
    const now = new Date("2026-09-16T09:00:00Z");
    const session = await makeSession({
      source: dexieSource(db),
      now,
      random: () => 0.4,
      mode: "practice",
      refs: [
        { kind: "phrase", id: "p-grafo" },
        { kind: "phrase", id: "p-vouno" },
        { kind: "word", id: "w11-27" },
      ],
    });
    await db.sessions.add(session);
    const grafo = session.items.find((item) => item.ref.id === "p-grafo")!,
      vouno = session.items.find((item) => item.ref.id === "p-vouno")!;
    await submitAnswer({
      session,
      item: grafo,
      correct: false,
      answer: "γραφω",
      responseTimeMs: 800,
      activeTimeMs: 800,
      timezone: "Asia/Nicosia",
      now,
      database: db,
    });
    await submitAnswer({
      session,
      item: vouno,
      correct: true,
      answer: "Το βουνό είναι ψηλό.",
      responseTimeMs: 800,
      activeTimeMs: 1600,
      timezone: "Asia/Nicosia",
      now,
      database: db,
    });
    const blob = await exportFull(db);
    const parsed = JSON.parse(await blob.text());
    const names = parsed.data.tables.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["phrases", "lessonItems", "cardStates", "events", "sessions"]));
    expect(names).not.toContain("clozes"); // снятое хранилище в копию не входит
    const fresh = new LexiDatabase("lexi-cards-restore");
    await fresh.delete();
    await fresh.open();
    await restoreBackup(asLexi(parsed), fresh);
    for (const name of [
      "words",
      "phrases",
      "lessonItems",
      "cardStates",
      "events",
      "sessions",
      "packages",
      "media",
    ] as const)
      expect(await fresh.table(name).toArray(), name).toEqual(await db.table(name).toArray());
    const events = await fresh.events.where("sessionId").equals(session.id).toArray();
    expect(events.find((e) => e.ref.id === "p-grafo")!.snapshot).toEqual({
      text: "Γράφω ένα γράμμα.",
      translation: "Я пишу письмо.",
    });
    expect(events.find((e) => e.ref.id === "p-vouno")!.snapshot).toEqual({
      text: "Το βουνό είναι ψηλό.",
      translation: "Гора высокая.",
    });
    expect((await fresh.sessions.get(session.id))!.status).toBe("active");
    fresh.close();
    await fresh.delete();
  });
  it("копия с фразами без слов допустима, а связь с отсутствующей карточкой отклоняется до замены данных", async () => {
    const noWords = buildMixed({
      phrases: { "p-grafo": MIXED_PHRASES["p-grafo"], "p-vouno": MIXED_PHRASES["p-vouno"] },
      lesson: {
        title: "Без слов",
        language: "el",
        items: [
          { kind: "phrase", id: "p-grafo" },
          { kind: "phrase", id: "p-vouno" },
        ],
      },
    });
    await installMixed(db, [MIXED_LESSON], noWords);
    expect(await db.words.count()).toBe(0);
    const parsed = JSON.parse(await (await exportFull(db)).text());
    const fresh = new LexiDatabase("lexi-cards-nowords");
    await fresh.delete();
    await fresh.open();
    await restoreBackup(asLexi(parsed), fresh);
    expect(await fresh.phrases.count()).toBe(2);
    expect((await lessonItems(MIXED_LESSON, fresh)).map((link) => link.ref.kind)).toEqual(["phrase", "phrase"]);
    // Битая ссылка на фразу: текущие данные не меняются.
    const broken = JSON.parse(JSON.stringify(parsed));
    broken.data.data
      .find((t: { tableName: string }) => t.tableName === "lessonItems")
      .rows.push({
        lessonId: MIXED_LESSON,
        unitKey: unitKey({ kind: "phrase", id: "нет" }),
        ref: { kind: "phrase", id: "нет" },
        position: 9,
      });
    const before = await fresh.lessonItems.count();
    await expect(restoreBackup(asLexi(broken), fresh)).rejects.toThrow(/несуществующую запись/);
    expect(await fresh.lessonItems.count()).toBe(before);
    fresh.close();
    await fresh.delete();
  });
  it("TSV по-прежнему содержит только слова", async () => {
    await installMixed(db);
    const tsv = await (await exportWordsTsv(db)).text();
    const lines = tsv.split("\n");
    expect(lines).toHaveLength(1 + (await db.words.count()));
    expect(tsv).not.toContain("Γράφω ένα γράμμα.");
  });
  it("обновление пакета, исправившее примечание фразы, меняет ревизию, но не ID и не прогресс", async () => {
    await installMixed(db);
    const pack = mixedPackage();
    const vouno = pack.phrases.find((p) => p.id === "p-vouno")!;
    const { revision: _r, ...fields } = vouno;
    const fixed = { ...fields, note: "Прилагательное согласуется с существительным." };
    const next = {
      ...pack,
      version: `${pack.version}-note`,
      phrases: pack.phrases.map((p) => (p.id === "p-vouno" ? { ...fixed, revision: phraseRevisionOf(fixed) } : p)),
    };
    await applyPackage(next, db);
    const stored = (await db.phrases.get("p-vouno"))!;
    expect(stored.note).toBe("Прилагательное согласуется с существительным.");
    expect(stored.revision).not.toBe(vouno.revision);
    expect(content.packages.length).toBeGreaterThan(0);
  });
});
