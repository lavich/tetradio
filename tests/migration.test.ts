import "fake-indexeddb/auto";
import "./helpers/self";
import Dexie from "dexie";
import { createEmptyCard } from "ts-fsrs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEGACY_CREATED, LexiDatabase } from "../src/storage/db";
import { installLesson, refreshCatalog } from "../src/content/client";
import { exportFull, inspectBackup, restoreBackup } from "../src/features/backup/backup";
import { lessonItems, searchWordIds } from "../src/storage/queries";
import { wordKeyOf, wordRef } from "./helpers/cards";
import { saveWord } from "../src/storage/ops";
import { content, installLessons, itemCountOf, memoryFetcher, packageOf, wordsOf } from "./helpers/content";

/** Схема первой версии: так выглядит база пользователя до обновления приложения. */
class LegacyDatabase extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      words: "id,greek,russian,deletedAt",
      lessons: "id,targetDate,status",
      assets: "id,kind",
      states: "wordId,introducedAt",
      events: "id,wordId,sessionId,localDate,type",
      sessions: "id,planDate,status",
      settings: "id",
      meta: "key",
    });
  }
}
const NAME = "lexi-migrate";
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

/** База старого профиля: исходные уроки установлены seed-ом, есть своё слово, правка, удаление и история. */
async function seedLegacy() {
  const legacy = new LegacyDatabase(NAME);
  await legacy.open();
  const l12 = wordsOf("lesson-1-2"),
    l13 = wordsOf("lesson-1-3");
  await legacy.table("words").bulkAdd([
    ...l12.map((w) =>
      legacyWord(w.id, w.greek, w.russian, { ipa: w.ipa, verified: w.verified, imageAssetId: w.imageAssetId }),
    ),
    ...l13.filter((w) => !l12.some((x) => x.id === w.id)).map((w) => legacyWord(w.id, w.greek, w.russian)),
    legacyWord("w-own", "η καρέκλα", "стул", {
      createdAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-16T10:00:00.000Z",
    }),
  ]);
  await legacy.table("words").update("w12-01", { russian: "моя правка", updatedAt: "2026-09-16T11:00:00.000Z" });
  await legacy.table("words").update("w12-02", { deletedAt: "2026-09-16T11:00:00.000Z" });
  await legacy.table("lessons").bulkAdd([
    {
      id: "lesson-1-2",
      title: "Урок 1.2",
      targetDate: "2026-09-18",
      status: "upcoming",
      wordIds: l12.map((w) => w.id),
      createdAt: LEGACY_CREATED,
      updatedAt: LEGACY_CREATED,
    },
    {
      id: "lesson-1-3",
      title: "Урок 1.3 (мебель)",
      targetDate: null,
      status: "upcoming",
      wordIds: l13.map((w) => w.id),
      createdAt: LEGACY_CREATED,
      updatedAt: "2026-09-16T12:00:00.000Z",
    },
    {
      id: "lesson-own",
      title: "Свой набор",
      targetDate: null,
      status: "upcoming",
      wordIds: ["w-own", "w12-16"],
      createdAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-16T10:00:00.000Z",
    },
  ]);
  await legacy.table("assets").add({
    id: "img-w12-16",
    kind: "image",
    blob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: "image/svg+xml" }),
    mimeType: "image/svg+xml",
    source: "тест",
    alt: "",
  });
  await legacy.table("states").add({
    wordId: "w12-16",
    card: { ...createEmptyCard(new Date("2026-09-01")), due: new Date("2026-09-14") },
    introducedAt: "2026-09-01T09:00:00Z",
    version: 2,
  });
  await legacy.table("events").add({
    id: "e1",
    sessionId: "s1",
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
  });
  await legacy.table("sessions").add({
    id: "s1",
    createdAt: "2026-09-14T09:00:00Z",
    planDate: "2026-09-14",
    items: [],
    index: 0,
    status: "done",
    activeTimeMs: 1000,
  });
  await legacy.table("settings").add({ id: "settings", timezone: "Asia/Nicosia", newWordsPerDay: 7, sessionSize: 12 });
  await legacy.table("meta").add({ key: "seed", value: "2026-09-16.2" });
  legacy.close();
}

beforeEach(async () => {
  await Dexie.delete(NAME);
});
afterEach(async () => {
  await Dexie.delete(NAME);
});

describe("миграция схемы без сети", () => {
  it("переносит wordIds в связи с порядком, отмечает исходные уроки установленными и не трогает данные пользователя", async () => {
    await seedLegacy();
    const db = new LexiDatabase(NAME);
    await db.open();
    expect(db.verno).toBe(7);
    const l12 = wordsOf("lesson-1-2");
    expect((await lessonItems("lesson-1-2", db)).map((link) => link.ref.id)).toEqual(l12.map((w) => w.id));
    expect((await lessonItems("lesson-own", db)).map((link) => [link.ref.id, link.position])).toEqual([
      ["w-own", 0],
      ["w12-16", 1],
    ]);
    expect(await db.lessonItems.where("unitKey").equals(wordKeyOf("w12-16")).count()).toBe(3);
    // Прежние словарные хранилища пусты: данные скопированы, а не продублированы.
    expect(await db.lessonWords.count()).toBe(0);
    expect(await db.states.count()).toBe(0);
    expect("wordIds" in (await db.lessons.get("lesson-1-2"))!).toBe(false);
    expect(await db.lessons.get("lesson-1-3")).toMatchObject({ title: "Урок 1.3 (мебель)" });
    expect(
      (await db.packages.toArray()).map((p) => [p.lessonId, p.version]).sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual([
      ["lesson-1-2", "legacy"],
      ["lesson-1-3", "legacy"],
    ]);
    expect(await db.packages.get("lesson-own")).toBeUndefined();
    // Прогресс, история, удаление, правка и медиа остаются как были.
    expect(await db.cardStates.get(wordKeyOf("w12-16"))).toMatchObject({
      ref: wordRef("w12-16"),
      version: 2,
      introducedAt: "2026-09-01T09:00:00Z",
    });
    expect((await db.events.get("e1"))!).toMatchObject({ ref: wordRef("w12-16"), unitKey: wordKeyOf("w12-16") });
    expect("wordId" in (await db.events.get("e1"))!).toBe(false);
    expect(await db.events.count()).toBe(1);
    expect((await db.words.get("w12-02"))!.deletedAt).toBeTruthy();
    expect(await db.words.get("w12-01")).toMatchObject({ russian: "моя правка", edited: true });
    expect((await db.words.get("w12-16"))!.edited).toBe(false);
    expect((await db.words.get("w-own"))!.edited).toBeUndefined();
    expect(await db.assets.count()).toBe(1);
    expect(await db.meta.get("seed")).toBeUndefined();
    expect((await db.courses.get("my"))!.newItemsPerDay).toBe(7); // лимит переехал в курс и стал пределом карточек
    expect("newWordsPerDay" in (await db.courses.get("my"))!).toBe(false);
    // Индексы построены для уже установленных слов.
    expect(await searchWordIds("σπι", db)).toEqual(["w12-16"]);
    expect(await searchWordIds("стул", db)).toEqual(["w-own"]);
    db.close();
  });
  it("заводит локальный курс и кладёт в него наборы без пакета, а поставляемые оставляет без курса", async () => {
    await seedLegacy();
    const db = new LexiDatabase(NAME);
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.courses.get("my")).toMatchObject({ id: "my", origin: "local", subscribed: true });
    expect((await db.lessons.get("lesson-own"))!.courseId).toBe("my"); // создан пользователем — пакета нет
    expect((await db.lessons.get("lesson-1-2"))!.courseId).toBeUndefined(); // пакет прежней сборки курса не знает
    expect(await db.courses.count()).toBe(1); // курсы из поставки появятся с каталогом
    db.close();
  });
  it("переносит общее расписание и лимит в каждый курс и убирает их из настроек", async () => {
    await seedLegacy();
    const db = new LexiDatabase(NAME);
    await db.open();
    expect(db.verno).toBe(7);
    const settings = (await db.settings.get("settings"))! as unknown as Record<string, unknown>;
    expect(settings.newWordsPerDay).toBeUndefined();
    expect(settings.schedule).toBeUndefined();
    expect(settings.sessionSize).toBe(12); // общее остаётся общим
    const own = await db.courses.get("my");
    expect(own).toMatchObject({ newItemsPerDay: 7, schedule: { startDate: null, weekdays: [] } });
    db.close();
  });
  it("после миграции первое обновление пакета заменяет нетронутые слова и сохраняет правки, удаления и порядок", async () => {
    await seedLegacy();
    const db = new LexiDatabase(NAME);
    await db.open();
    const fetcher = memoryFetcher();
    await refreshCatalog(db, fetcher);
    const result = await installLesson("lesson-1-2", db, fetcher);
    expect(result.status).toBe("updated");
    expect(result.conflicts.map((c) => c.ref.id).sort()).toEqual(["w12-01", "w12-02"]); // правка и удаление против нового содержимого
    expect(await db.words.get("w12-01")).toMatchObject({ russian: "моя правка" });
    expect((await db.words.get("w12-02"))!.deletedAt).toBeTruthy();
    const shipped = packageOf("lesson-1-2").words.find((w) => w.id === "w12-16")!;
    expect(await db.words.get("w12-16")).toMatchObject({ examples: shipped.examples, revision: shipped.revision });
    expect(await db.cardStates.get(wordKeyOf("w12-16"))).toMatchObject({
      ref: wordRef("w12-16"),
      version: 2,
      introducedAt: "2026-09-01T09:00:00Z",
    });
    expect((await db.events.get("e1"))!).toMatchObject({ ref: wordRef("w12-16"), unitKey: wordKeyOf("w12-16") });
    expect("wordId" in (await db.events.get("e1"))!).toBe(false);
    expect((await lessonItems("lesson-1-2", db)).map((link) => link.ref.id)).toEqual(
      wordsOf("lesson-1-2").map((w) => w.id),
    );
    expect((await db.packages.get("lesson-1-2"))!.version).toBe(packageOf("lesson-1-2").version);
    // Урок ищется по идентификатору: положение в каталоге меняется при добавлении уроков.
    expect(fetcher.requests).toEqual([
      "content/catalog.json",
      content.catalog.lessons.find((entry) => entry.id === "lesson-1-2")!.url,
    ]);
    db.close();
  });
});

/** Тестовая база называется иначе, а копия проверяется по имени базы приложения. */
const asLexi = (parsed: { data: { databaseName: string } }) =>
  new Blob([JSON.stringify({ ...parsed, data: { ...parsed.data, databaseName: "lexi" } })], {
    type: "application/json",
  });

/** Схема 6: профиль с карточками снятого вида — связи, состояния, навыки, отложенный прогресс, сессия и пакет. */
class V6Database extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(6).stores({
      words: "id,greek,russian,deletedAt,key,greekKey,[sortKey+id],*tokens",
      phrases: "id,deletedAt",
      clozes: "id,deletedAt",
      lessons: "id,targetDate,status,courseId",
      lessonItems: "[lessonId+unitKey],unitKey,[lessonId+position]",
      lessonWords: "[lessonId+wordId],wordId,[lessonId+position]",
      courses: "id,origin",
      assets: "id,kind",
      media: "id",
      packages: "lessonId",
      catalog: "id,courseId",
      cardStates: "unitKey,introducedAt,card.due,ref.kind",
      states: "wordId,introducedAt,card.due",
      events: "id,unitKey,sessionId,localDate,type,createdAt,[unitKey+createdAt],[type+createdAt]",
      sessions: "id,planDate,status,[status+createdAt]",
      settings: "id",
      meta: "key",
      cardSkills: "unitKey",
      baseSkills: "wordId",
      baseSummary: "id",
      syncVersions: "id,createdAt",
      syncStash: "wordId",
      cardStash: "unitKey",
    });
  }
}
const DROPPED = "lexi-drop-cloze";
const key = (kind: string, id: string) => JSON.stringify([kind, id]);
const at = "2026-09-16T09:00:00.000Z";
const stateRow = (kind: string, id: string) => ({
  unitKey: key(kind, id),
  ref: { kind, id },
  card: { ...createEmptyCard(new Date("2026-09-01")), due: new Date("2026-09-20") },
  introducedAt: at,
  version: 2,
});
const sessionItem = (kind: string, id: string, index: number, over: Record<string, unknown> = {}) => ({
  id: `item-${index}`,
  ref: { kind, id },
  unitKey: key(kind, id),
  card: kind === "cloze" ? { kind, cloze: { id } } : { kind, phrase: { id } },
  type: kind === "cloze" ? "cloze" : "spelling",
  options: [],
  isNew: false,
  mode: "scheduled",
  expectedVersion: 2,
  ...over,
});

/** Схема 7 снимает вид карточек «заполни пропуск»: ключи уходят, история ответов остаётся. */
describe("миграция схемы 7: снятие вида карточек", () => {
  beforeEach(async () => {
    await new LexiDatabase(DROPPED).delete();
    const legacy = new V6Database(DROPPED);
    await legacy.open();
    await legacy.table("phrases").add({ id: "p1", text: "Καλημέρα.", createdAt: at, updatedAt: at });
    await legacy.table("clozes").bulkAdd([
      { id: "c1", template: "{{gap}} ένα γράμμα.", answer: "Γράφω", createdAt: at, updatedAt: at },
      { id: "c2", template: "Γράφω ένα {{gap}}.", answer: "γράμμα", createdAt: at, updatedAt: at },
    ]);
    await legacy.table("lessons").add({ id: "l1", title: "Урок", targetDate: null, status: "upcoming" });
    await legacy.table("lessonItems").bulkAdd([
      { lessonId: "l1", unitKey: key("phrase", "p1"), ref: { kind: "phrase", id: "p1" }, position: 0 },
      { lessonId: "l1", unitKey: key("cloze", "c1"), ref: { kind: "cloze", id: "c1" }, position: 1 },
      { lessonId: "l1", unitKey: key("cloze", "c2"), ref: { kind: "cloze", id: "c2" }, position: 2 },
    ]);
    await legacy.table("cardStates").bulkAdd([stateRow("phrase", "p1"), stateRow("cloze", "c1")]);
    await legacy.table("cardSkills").bulkAdd([
      { unitKey: key("phrase", "p1"), ref: { kind: "phrase", id: "p1" }, skills: {} },
      { unitKey: key("cloze", "c1"), ref: { kind: "cloze", id: "c1" }, skills: {} },
    ]);
    await legacy.table("cardStash").bulkAdd([
      { unitKey: key("phrase", "p1"), ref: { kind: "phrase", id: "p1" }, state: {} },
      { unitKey: key("cloze", "c2"), ref: { kind: "cloze", id: "c2" }, state: {} },
    ]);
    await legacy.table("events").bulkAdd([
      {
        id: "e1",
        sessionId: "s1",
        itemId: "item-1",
        ref: { kind: "cloze", id: "c1" },
        unitKey: key("cloze", "c1"),
        snapshot: { template: "{{gap}} ένα γράμμα.", answer: "Γράφω" },
        type: "cloze",
        mode: "scheduled",
        rating: 3,
        correct: true,
        answer: "Γράφω",
        createdAt: at,
        localDate: "2026-09-16",
        responseTimeMs: 900,
      },
    ]);
    await legacy.table("sessions").bulkAdd([
      {
        id: "s1",
        createdAt: at,
        planDate: "2026-09-16",
        index: 2,
        status: "active",
        activeTimeMs: 1000,
        introducedKeys: [key("cloze", "c1"), key("phrase", "p1")],
        items: [
          sessionItem("cloze", "c1", 1, { eventId: "e1" }),
          sessionItem("phrase", "p1", 2),
          sessionItem("cloze", "c2", 3),
        ],
      },
      {
        id: "s2",
        createdAt: at,
        planDate: "2026-09-16",
        index: 0,
        status: "active",
        activeTimeMs: 0,
        items: [sessionItem("cloze", "c2", 4)],
      },
    ]);
    await legacy.table("packages").add({
      lessonId: "l1",
      version: "v1",
      schemaVersion: 3,
      installedAt: at,
      words: [],
      phrases: [{ id: "p1" }],
      clozes: [{ id: "c1" }, { id: "c2" }],
      items: [
        { kind: "phrase", id: "p1", position: 0 },
        { kind: "cloze", id: "c1", position: 1 },
      ],
      media: [],
      removed: [key("cloze", "c2")],
    });
    legacy.close();
  });
  afterEach(async () => {
    await new LexiDatabase(DROPPED).delete();
  });
  it("удаляет карточки, связи, состояния, навыки и отложенный прогресс снятого вида, историю оставляет", async () => {
    const db = new LexiDatabase(DROPPED);
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.clozes.count()).toBe(0);
    expect((await lessonItems("l1", db)).map((link) => link.ref.id)).toEqual(["p1"]);
    expect((await db.cardStates.toCollection().primaryKeys()) as string[]).toEqual([key("phrase", "p1")]);
    expect((await db.cardSkills.toCollection().primaryKeys()) as string[]).toEqual([key("phrase", "p1")]);
    expect((await db.cardStash.toCollection().primaryKeys()) as string[]).toEqual([key("phrase", "p1")]);
    // Событие — запись о том, что было: тип проверки читается, снимок задания цел.
    const events = await db.events.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "cloze", unitKey: key("cloze", "c1") });
    expect(events[0].snapshot).toEqual({ template: "{{gap}} ένα γράμμα.", answer: "Γράφω" });
    // Состав установленного пакета тоже чистится, иначе обновление увидит «автор убрал карточку».
    const pack = (await db.packages.get("l1"))!;
    expect("clozes" in pack).toBe(false);
    expect(pack.items).toEqual([{ kind: "phrase", id: "p1", position: 0 }]);
    expect(pack.removed).toEqual([]);
    db.close();
  });
  it("незавершённая сессия продолжается с оставшегося задания, сессия только из снятых завершается", async () => {
    const db = new LexiDatabase(DROPPED);
    await db.open();
    const live = (await db.sessions.get("s1"))!;
    expect(live.items.map((item) => item.ref.id)).toEqual(["p1"]);
    expect(live.index).toBe(1); // пройдены были пропуск и фраза; пропуска больше нет, позиция встала на фразу
    expect(live.introducedKeys).toEqual([key("phrase", "p1")]);
    expect(live.status).toBe("active");
    const gone = (await db.sessions.get("s2"))!;
    expect(gone.items).toEqual([]);
    expect(gone.status).toBe("ended");
    db.close();
  });
});

describe("резервная копия", () => {
  let db: LexiDatabase;
  beforeEach(async () => {
    db = new LexiDatabase(NAME);
    await db.open();
  });
  afterEach(() => db.close());
  it("новая копия содержит связи, медиа и метаданные пакетов, но не каталог; восстановление воспроизводит данные", async () => {
    await installLessons(db, ["lesson-1-2"]);
    await saveWord({ ...(await db.words.get("w12-16"))!, russian: "дом (правка)" }, db);
    await db.courses.update("leeke", { schedule: { startDate: "2026-09-14", weekdays: [1, 4], lessonHour: 19 } });
    const blob = await exportFull(db);
    const parsed = JSON.parse(await blob.text());
    const names = parsed.data.tables.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["lessonItems", "cardStates", "phrases", "packages", "media", "words"]),
    );
    // Пустые площадки снятых хранилищ в копию не входят.
    expect(names).not.toEqual(expect.arrayContaining(["lessonWords"]));
    expect(names).not.toEqual(expect.arrayContaining(["clozes"]));
    expect(parsed.data.data.find((t: { tableName: string }) => t.tableName === "catalog")?.rows ?? []).toEqual([]);
    const copy = asLexi(parsed);
    const check = await inspectBackup(copy);
    expect(check.ok && check.report.legacy).toBe(false);
    const fresh = new LexiDatabase("lexi-restore-target");
    await fresh.delete();
    await fresh.open();
    await restoreBackup(copy, fresh);
    expect(await fresh.words.count()).toBe(30);
    expect(await fresh.lessonItems.count()).toBe(30);
    expect((await fresh.packages.get("lesson-1-2"))!.version).toBe(packageOf("lesson-1-2").version);
    expect(await fresh.words.get("w12-16")).toMatchObject({ russian: "дом (правка)", edited: true });
    expect(await fresh.catalog.count()).toBe(0);
    expect((await fresh.courses.get("leeke"))!.schedule.lessonHour).toBe(19);
    fresh.close();
    await fresh.delete();
  });
  it("разметка слов примера входит в полную копию и восстанавливается", async () => {
    await installLessons(db, ["lesson-1-2"]);
    const house = (await db.words.get("w12-16"))!;
    const glosses = [{ start: 3, length: 5, russian: "дом", wordId: "w12-16" }];
    await db.words.put({ ...house, examples: [{ ...house.examples[0], glosses }] });
    const copy = asLexi(JSON.parse(await (await exportFull(db)).text()));
    const fresh = new LexiDatabase("lexi-restore-glosses");
    await fresh.delete();
    await fresh.open();
    await restoreBackup(copy, fresh);
    expect((await fresh.words.get("w12-16"))!.examples[0].glosses).toEqual(glosses);
    expect((await fresh.words.get("w12-18"))!.examples.every((example) => example.glosses === undefined)).toBe(true);
    fresh.close();
    await fresh.delete();
  });
  it("старая копия с wordIds преобразуется в связи без скачивания пакетов", async () => {
    const legacy = {
      formatName: "dexie",
      formatVersion: 1,
      data: {
        databaseName: "lexi",
        databaseVersion: 1,
        tables: Object.entries({
          words: "id,greek,russian,deletedAt",
          lessons: "id,targetDate,status",
          assets: "id,kind",
          states: "wordId,introducedAt",
          events: "id,wordId,sessionId,localDate,type",
          sessions: "id,planDate,status",
          settings: "id",
          meta: "key",
        }).map(([name, schema]) => ({ name, schema, rowCount: 0 })),
        data: [
          {
            tableName: "words",
            inbound: true,
            rows: [
              { ...legacyWord("w12-16", "το σπίτι", "дом"), $types: {} },
              { ...legacyWord("w-own", "η καρέκλα", "стул"), $types: {} },
            ],
          },
          {
            tableName: "lessons",
            inbound: true,
            rows: [
              {
                id: "lesson-1-2",
                title: "Урок 1.2",
                targetDate: "2026-09-18",
                status: "upcoming",
                wordIds: ["w12-16", "w-own"],
                createdAt: LEGACY_CREATED,
                updatedAt: LEGACY_CREATED,
              },
            ],
          },
          { tableName: "assets", inbound: true, rows: [] },
          { tableName: "states", inbound: true, rows: [] },
          { tableName: "events", inbound: true, rows: [] },
          { tableName: "sessions", inbound: true, rows: [] },
          {
            tableName: "settings",
            inbound: true,
            rows: [{ id: "settings", timezone: "Asia/Nicosia", newWordsPerDay: 10, sessionSize: 20 }],
          },
          {
            tableName: "meta",
            inbound: true,
            rows: [
              { key: "app", value: "lexi:1" },
              { key: "seed", value: "2026-09-16.2" },
            ],
          },
        ],
      },
    };
    const blob = new Blob([JSON.stringify(legacy)], { type: "application/json" });
    const check = await inspectBackup(blob);
    expect(check).toMatchObject({ ok: true, report: { legacy: true } });
    await installLessons(db, ["lesson-1-1"]); // текущие данные, которые копия заменит
    await restoreBackup(blob, db);
    expect(await db.words.count()).toBe(2);
    expect((await lessonItems("lesson-1-2", db)).map((link) => link.ref.id)).toEqual(["w12-16", "w-own"]);
    expect((await db.packages.toArray()).map((p) => [p.lessonId, p.version])).toEqual([["lesson-1-2", "legacy"]]);
    // Копия сохранена до появления часа занятия: курс получает час по умолчанию.
    expect((await db.courses.get("my"))!.schedule).toEqual({ startDate: null, weekdays: [], lessonHour: 12 });
    expect(await searchWordIds("καρ", db)).toEqual(["w-own"]);
    expect(await db.catalog.count()).toBe(content.catalog.lessons.length); // каталог не считается данными пользователя и остаётся
  });
  it("копия схемы 6 с карточками снятого вида восстанавливается без них, история ответов остаётся", async () => {
    const stamp = "2026-09-16T09:00:00.000Z";
    const clozeKey = JSON.stringify(["cloze", "c1"]);
    const phraseKey = JSON.stringify(["phrase", "p1"]);
    const rows: Record<string, unknown[]> = {
      words: [],
      phrases: [{ id: "p1", text: "Καλημέρα.", provenance: {}, createdAt: stamp, updatedAt: stamp, revision: "r1" }],
      clozes: [
        {
          id: "c1",
          template: "{{gap}} ένα γράμμα.",
          answer: "Γράφω",
          acceptedAnswers: ["Γράφω"],
          provenance: {},
          createdAt: stamp,
          updatedAt: stamp,
          revision: "r2",
        },
      ],
      lessons: [{ id: "l1", title: "Урок", targetDate: null, status: "upcoming", createdAt: stamp, updatedAt: stamp }],
      courses: [],
      lessonItems: [
        { lessonId: "l1", unitKey: phraseKey, ref: { kind: "phrase", id: "p1" }, position: 0 },
        { lessonId: "l1", unitKey: clozeKey, ref: { kind: "cloze", id: "c1" }, position: 1 },
      ],
      assets: [],
      media: [],
      packages: [],
      cardStates: [
        {
          unitKey: clozeKey,
          ref: { kind: "cloze", id: "c1" },
          card: createEmptyCard(new Date("2026-09-01")),
          introducedAt: stamp,
          version: 1,
        },
      ],
      events: [
        {
          id: "e1",
          sessionId: "s1",
          itemId: "i1",
          ref: { kind: "cloze", id: "c1" },
          unitKey: clozeKey,
          snapshot: { template: "{{gap}} ένα γράμμα.", answer: "Γράφω" },
          type: "cloze",
          mode: "scheduled",
          rating: 3,
          correct: true,
          answer: "Γράφω",
          createdAt: stamp,
          localDate: "2026-09-16",
          responseTimeMs: 900,
        },
      ],
      sessions: [],
      settings: [{ id: "settings", timezone: "Asia/Nicosia", sessionSize: 20 }],
      meta: [{ key: "app", value: "lexi:1" }],
      cardSkills: [{ unitKey: clozeKey, ref: { kind: "cloze", id: "c1" }, skills: {} }],
      baseSummary: [],
      cardStash: [],
    };
    // Индексы копии совпадают со схемой 6: импорт сверяет первичные ключи таблиц.
    const schemas: Record<string, string> = {
      words: "id,greek,russian,deletedAt,key,greekKey,[sortKey+id],*tokens",
      phrases: "id,deletedAt",
      clozes: "id,deletedAt",
      lessons: "id,targetDate,status,courseId",
      courses: "id,origin",
      lessonItems: "[lessonId+unitKey],unitKey,[lessonId+position]",
      assets: "id,kind",
      media: "id",
      packages: "lessonId",
      cardStates: "unitKey,introducedAt,card.due,ref.kind",
      events: "id,unitKey,sessionId,localDate,type,createdAt,[unitKey+createdAt],[type+createdAt]",
      sessions: "id,planDate,status,[status+createdAt]",
      settings: "id",
      meta: "key",
      cardSkills: "unitKey",
      baseSummary: "id",
      cardStash: "unitKey",
    };
    const blob = new Blob([
      JSON.stringify({
        formatName: "dexie",
        formatVersion: 1,
        data: {
          databaseName: "lexi",
          databaseVersion: 6,
          tables: Object.keys(rows).map((name) => ({
            name,
            schema: schemas[name],
            rowCount: rows[name].length,
          })),
          data: Object.entries(rows).map(([tableName, rows]) => ({ tableName, inbound: true, rows })),
        },
      }),
    ]);
    // Отсутствие таблицы снятого вида повреждением не считается — как и её наличие в прежней копии.
    expect(await inspectBackup(blob)).toMatchObject({ ok: true, report: { legacy: true } });
    await restoreBackup(blob, db);
    expect(await db.phrases.count()).toBe(1);
    expect(await db.clozes.count()).toBe(0);
    expect((await lessonItems("l1", db)).map((link) => link.ref.id)).toEqual(["p1"]);
    expect(await db.cardStates.count()).toBe(0);
    expect(await db.cardSkills.count()).toBe(0);
    const events = await db.events.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "cloze", unitKey: clozeKey });
  });
  it("повреждённая копия, копия новее приложения и копия с битыми связями отклоняются без изменения данных", async () => {
    await installLessons(db, ["lesson-1-1"]);
    const before = await db.words.count();
    expect(await inspectBackup(new Blob(["{не json"]))).toMatchObject({ ok: false });
    expect(
      await inspectBackup(
        new Blob([
          JSON.stringify({
            formatName: "dexie",
            formatVersion: 1,
            data: { databaseName: "lexi", databaseVersion: 8, tables: [], data: [] },
          }),
        ]),
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/более новой версией/) });
    expect(
      await inspectBackup(
        new Blob([
          JSON.stringify({
            formatName: "dexie",
            formatVersion: 1,
            data: { databaseName: "lexi", databaseVersion: 2, tables: [{ name: "words", rowCount: 0 }], data: [] },
          }),
        ]),
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/обязательных таблиц/) });
    const good = JSON.parse(await (await exportFull(db)).text());
    const links = good.data.data.find((t: { tableName: string }) => t.tableName === "lessonItems");
    links.rows.push({
      lessonId: "lesson-1-1",
      unitKey: wordKeyOf("нет-такого"),
      ref: wordRef("нет-такого"),
      position: 99,
    });
    await expect(restoreBackup(asLexi(good), db)).rejects.toThrow(/несуществующую запись/);
    expect(await db.words.count()).toBe(before);
    expect(await db.lessonItems.count()).toBe(itemCountOf("lesson-1-1"));
  });
});
