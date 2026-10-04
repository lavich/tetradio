import Dexie from "dexie";
import { createEmptyCard, State, type Card } from "ts-fsrs";
import { buildContent } from "../../content/build";
import { parseCatalog, parsePackage, type ContentPackage } from "../../src/content/schema";
import { indexWord } from "../../src/storage/db";
import { unitKey } from "../../src/domain/refs";
import type { LearningRef } from "../../src/domain/types";

/** Схема базы v8 в том виде, в каком она лежит у пользователя до обновления. */
export const V8_STORES = {
  words: "id,greek,russian,deletedAt,key,greekKey,[sortKey+id],*tokens",
  lessons: "id,targetDate,status,courseId",
  lessonWords: "[lessonId+wordId],wordId,[lessonId+position]",
  assets: "id,kind",
  media: "id",
  packages: "lessonId",
  catalog: "id,courseId",
  states: "wordId,introducedAt,card.due",
  events: "id,unitKey,sessionId,localDate,type,createdAt,[unitKey+createdAt],[type+createdAt]",
  sessions: "id,planDate,status,[status+createdAt]",
  settings: "id",
  meta: "key",
  baseSkills: "wordId",
  baseSummary: "id",
  syncVersions: "id,createdAt",
  syncStash: "wordId",
  courses: "id,origin",
  phrases: "id,deletedAt",
  clozes: "id,deletedAt",
  lessonItems: "[lessonId+unitKey],unitKey,[lessonId+position]",
  cardStates: "unitKey,introducedAt,card.due,ref.kind",
  cardSkills: "unitKey",
  cardStash: "unitKey",
  modules: "id,courseId,number",
  blockProgress: "key,lessonId",
};

export class V8Database extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(8).stores(V8_STORES);
  }
}

export const V8_NOW = new Date("2026-10-04T08:00:00.000Z");
const INSTALLED = "2026-09-10T08:00:00.000Z";
const demo = buildContent("tests/fixtures/course-demo");
const json = (path: string) => {
  const body = demo.files.find((file) => file.path === path)!.body;
  return typeof body === "string" ? JSON.parse(body) : body;
};
export const v8Catalog = parseCatalog(json("content/catalog.json"));
export const v8Packages: ContentPackage[] = v8Catalog.lessons.map((entry) => parsePackage(json(entry.url)));
const pack = (id: string) => v8Packages.find((item) => item.id === id)!;

const card = (over: Partial<Card>): Card => ({ ...createEmptyCard(new Date("2026-09-20T08:00:00.000Z")), ...over });
const state = (ref: LearningRef, introducedAt: string, over: Partial<Card>, version = 1) => ({
  unitKey: unitKey(ref),
  ref,
  card: card(over),
  introducedAt,
  version,
});
const event = (
  id: string,
  ref: LearningRef,
  type: string,
  createdAt: string,
  correct: boolean,
  snapshot: Record<string, string>,
  mode = "scheduled",
) => ({
  id,
  sessionId: "s-old",
  itemId: `i-${id}`,
  ref,
  unitKey: unitKey(ref),
  snapshot,
  type,
  mode,
  rating: correct ? 3 : 1,
  correct,
  answer: "",
  createdAt,
  localDate: createdAt.slice(0, 10),
  responseTimeMs: 2000,
});

/** Копия базы v8 с прогрессом: курс из модулей, пройденные уроки, состояния, ответы, навыки, задания и настройки. */
export async function seedV8(name: string): Promise<void> {
  const legacy = new V8Database(name);
  await legacy.open();
  const lesson = pack("m01-1");
  const geia = { kind: "word", id: "geia" } as const;
  const kalimera = { kind: "word", id: "kalimera" } as const;
  const apo = { kind: "word", id: "apo" } as const;
  await legacy.table("catalog").bulkAdd(v8Catalog.lessons.map((entry, position) => ({ ...entry, position })));
  await legacy.table("modules").bulkAdd((v8Catalog.modules ?? []).map((module, position) => ({ ...module, position })));
  const course = v8Catalog.courses[0];
  await legacy.table("courses").bulkAdd([
    {
      id: course.id,
      title: course.title,
      language: course.language,
      origin: "content",
      subscribed: true,
      schedule: { startDate: "2026-09-01", weekdays: [1, 3], lessonHour: 18 },
      newItemsPerDay: 3,
      exam: course.exam,
      syncedAt: INSTALLED,
      createdAt: INSTALLED,
      updatedAt: INSTALLED,
    },
    {
      id: "my",
      title: "Мои слова",
      origin: "local",
      subscribed: true,
      schedule: { startDate: null, weekdays: [], lessonHour: 12 },
      newItemsPerDay: 12,
      createdAt: INSTALLED,
      updatedAt: INSTALLED,
    },
  ]);
  const status: Record<string, { status: string; targetDate: string | null; updatedAt: string }> = {
    "m01-1": { status: "completed", targetDate: "2026-09-21", updatedAt: "2026-09-21T15:00:00.000Z" },
    "m01-test": { status: "completed", targetDate: null, updatedAt: "2026-09-29T15:00:00.000Z" },
    "m01-k1": { status: "upcoming", targetDate: "2026-10-12", updatedAt: INSTALLED },
    "m01-r1": { status: "upcoming", targetDate: null, updatedAt: INSTALLED },
  };
  await legacy.table("lessons").bulkAdd(
    v8Packages.map((item) => ({
      id: item.id,
      courseId: item.courseId,
      title: item.lesson.title,
      ...status[item.id],
      ...(status[item.id].targetDate ? { dateSource: "schedule" } : {}),
      createdAt: INSTALLED,
    })),
  );
  await legacy.table("packages").bulkAdd(
    v8Packages.map((item) => ({
      lessonId: item.id,
      courseId: item.courseId,
      version: item.version,
      schemaVersion: item.schemaVersion,
      installedAt: INSTALLED,
      words: item.words,
      phrases: item.phrases,
      items: item.items,
      media: item.media,
      removed: [],
      ...(item.lesson.kind ? { kind: item.lesson.kind } : {}),
      ...(item.module ? { module: item.module } : {}),
      ...(item.blocks ? { blocks: item.blocks } : {}),
      ...(item.marks ? { marks: item.marks } : {}),
    })),
  );
  await legacy.table("words").bulkAdd(
    lesson.words.map((word) => {
      const { revision, ...fields } = word;
      const row = indexWord({ ...fields, createdAt: INSTALLED, updatedAt: INSTALLED, revision });
      if (word.id === "kalimera") return { ...row, edited: true };
      if (word.id === "apo") return { ...row, deletedAt: "2026-09-25T10:00:00.000Z" };
      return row;
    }),
  );
  await legacy.table("phrases").bulkAdd(
    lesson.phrases.map(({ revision, ...rest }) => ({
      ...rest,
      createdAt: INSTALLED,
      updatedAt: INSTALLED,
      revision,
    })),
  );
  await legacy.table("lessonItems").bulkAdd(
    v8Packages.flatMap((item) =>
      item.items.map((entry) => ({
        lessonId: item.id,
        unitKey: unitKey({ kind: entry.kind, id: entry.id }),
        ref: { kind: entry.kind, id: entry.id },
        position: entry.position,
      })),
    ),
  );
  await legacy.table("cardStates").bulkAdd([
    state(geia, "2026-09-21T16:00:00.000Z", {
      state: State.Review,
      due: new Date("2026-10-03T06:00:00.000Z"),
      stability: 30,
      difficulty: 4,
      scheduled_days: 25,
      reps: 4,
      lapses: 0,
      last_review: new Date("2026-09-08T06:00:00.000Z"),
    }),
    state(kalimera, "2026-10-04T06:30:00.000Z", {
      state: State.Learning,
      due: new Date("2026-10-04T07:00:00.000Z"),
      stability: 1,
      difficulty: 6,
      scheduled_days: 0,
      reps: 1,
      lapses: 0,
      last_review: new Date("2026-10-04T06:40:00.000Z"),
    }),
    state(apo, "2026-09-22T16:00:00.000Z", {
      state: State.Review,
      due: new Date("2026-10-02T06:00:00.000Z"),
      stability: 5,
      difficulty: 7,
      scheduled_days: 6,
      reps: 9,
      lapses: 8,
      last_review: new Date("2026-09-26T06:00:00.000Z"),
    }),
  ]);
  await legacy.table("events").bulkAdd([
    event("e1", geia, "recall", "2026-09-21T16:00:00.000Z", true, { greek: "γεια", russian: "привет" }),
    event("e2", geia, "recognition", "2026-09-30T06:00:00.000Z", true, { greek: "γεια", russian: "привет" }),
    event("e3", apo, "spelling", "2026-10-01T06:00:00.000Z", false, { greek: "από", russian: "из" }),
    event("e4", kalimera, "recognition", "2026-10-04T06:40:00.000Z", true, {
      greek: "καλημέρα",
      russian: "доброе утро",
    }),
    event("e5", { kind: "cloze", id: "c1" } as never, "cloze", "2026-09-28T06:00:00.000Z", true, {
      template: "_ είμαι",
      answer: "εγώ",
    }),
    event(
      "e6",
      kalimera,
      "assembly",
      "2026-10-03T18:00:00.000Z",
      true,
      { greek: "καλημέρα", russian: "доброе утро" },
      "practice",
    ),
  ]);
  await legacy.table("cardSkills").bulkAdd([
    {
      unitKey: unitKey(geia),
      ref: geia,
      skills: {
        types: { recognition: { recent: [true], lastAt: "2026-09-30T06:00:00.000Z" } },
        lastTypes: ["recognition"],
        cleanAssemblies: 1,
      },
    },
    {
      unitKey: unitKey(apo),
      ref: apo,
      skills: { types: {}, lastTypes: [], cleanAssemblies: 0 },
    },
  ]);
  const progressOf = (lessonId: string, scored: boolean) =>
    (pack(lessonId).blocks ?? []).map((block, index) => ({
      key: `${lessonId}/${block.id}`,
      lessonId,
      blockId: block.id,
      done: true,
      ...(scored && block.type === "exercise" ? { score: { correct: index % 2 ? 2 : 1, almost: 0, total: 2 } } : {}),
      ...(block.type === "writing" || block.type === "speaking"
        ? { checks: [0], ...(block.type === "writing" ? { text: "Γεια σας!" } : {}) }
        : {}),
      updatedAt: lessonId === "m01-1" ? "2026-09-21T14:00:00.000Z" : "2026-09-29T14:00:00.000Z",
    }));
  await legacy.table("blockProgress").bulkAdd([...progressOf("m01-1", false), ...progressOf("m01-test", true)]);
  await legacy
    .table("settings")
    .add({ id: "settings", timezone: "Asia/Nicosia", sessionSize: 15, errorReports: false, autoSpeak: true });
  await legacy.table("meta").bulkAdd([
    { key: "catalogUpdatedAt", value: INSTALLED },
    { key: "sync:device", value: "dev-1" },
  ]);
  const item = (id: string, ref: LearningRef, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    ref,
    unitKey: unitKey(ref),
    card: {
      kind: "word",
      word: indexWord({
        ...lesson.words.find((word) => word.id === ref.id)!,
        createdAt: INSTALLED,
        updatedAt: INSTALLED,
      }),
    },
    type,
    options: [],
    isNew: false,
    mode: "scheduled",
    expectedVersion: 1,
    ...extra,
  });
  await legacy.table("sessions").bulkAdd([
    {
      id: "s-old",
      createdAt: "2026-09-30T05:59:00.000Z",
      planDate: "2026-09-30",
      items: [item("i-e2", geia, "recognition", { eventId: "e2" })],
      index: 1,
      status: "done",
      activeTimeMs: 60000,
    },
    {
      id: "s-recall",
      createdAt: "2026-10-03T05:59:00.000Z",
      planDate: "2026-10-03",
      items: [item("i-r1", geia, "recall")],
      index: 0,
      status: "active",
      activeTimeMs: 0,
    },
  ]);
  legacy.close();
}
