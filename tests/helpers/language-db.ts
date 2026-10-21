import { createEmptyCard, State } from "ts-fsrs";
import type { Language } from "../../src/domain/language";
import { phraseRef, unitKey, wordKeyOf, wordRef } from "../../src/domain/refs";
import type { LearningState, Session, Word } from "../../src/domain/types";
import { indexWord, type AppDatabase, type StoredCatalogEntry } from "../../src/storage/db";
import { rememberCourses } from "../../src/storage/courses";

/** Курсы базы: два-три английских и греческий; у каждого модуль из пройденного урока `-1` и следующего `-2`. */
export const COURSES: Record<string, { language: Language; title: string; short?: string; order: number }> = {
  greek: { language: "el", title: "Греческий", order: 1 },
  it: { language: "en", title: "Английский для IT", short: "Для IT", order: 2 },
  travel: { language: "en", title: "Английский для путешествий", short: "Для путешествий", order: 3 },
  talk: { language: "en", title: "Английский для общения", short: "Для общения", order: 4 },
  four: { language: "en", title: "Английский четвёртый", short: "Четвёртый", order: 5 },
};
export const NOW = new Date("2026-10-08T09:00:00Z");
const iso = NOW.toISOString();
const WORDS = 4;

export const wordId = (courseId: string, index: number) => `${courseId}-w${index}`;
export const phraseId = (courseId: string, index: number) => `${courseId}-p${index}`;
export const wordOf = (courseId: string, index: number): Word => ({
  id: wordId(courseId, index),
  greek: COURSES[courseId].language === "el" ? `το λέξη${courseId}${index}` : `the ${courseId} word ${index}`,
  russian: `${courseId}-слово${index}`,
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: iso,
  updatedAt: iso,
});
const entry = (id: string, courseId: string, position: number, title: string): StoredCatalogEntry => ({
  id,
  courseId,
  language: COURSES[courseId].language,
  title,
  wordCount: WORDS,
  phraseCount: 0,
  cardCount: WORDS,
  version: "1",
  url: "",
  bytes: 0,
  media: { count: 0, bytes: 0 },
  position,
});
export const lessonTitle = (courseId: string, n: number) => `${COURSES[courseId].short ?? courseId} урок ${n}`;

/** Каталог всех курсов: записи курсов, уроков и модулей. Уроков на устройстве нет. */
export async function seedCatalog(database: AppDatabase, ids = Object.keys(COURSES)) {
  await database.transaction("rw", database.courses, database.catalog, database.modules, async () => {
    for (const id of ids) {
      const { title, short, order } = COURSES[id];
      await database.courses.add({ id, title, ...(short ? { short } : {}), order, updatedAt: iso });
      await database.catalog.bulkAdd([
        entry(`${id}-1`, id, order * 10, lessonTitle(id, 1)),
        entry(`${id}-2`, id, order * 10 + 1, lessonTitle(id, 2)),
      ]);
      await database.modules.add({
        id: `${id}-m1`,
        courseId: id,
        number: 1,
        title: `${id} модуль`,
        subtitle: "",
        status: "published",
        goal: "",
        grammar: [],
        sessions: 2,
        lessonIds: [`${id}-1`, `${id}-2`],
        position: order,
      });
    }
  });
}

/** Курс начат: пройденный урок `-1` с четырьмя словами на устройстве; `due` слов — к повторению вчера. */
export async function install(database: AppDatabase, courseId: string, { due = 0, at = iso, phrases = 0 } = {}) {
  const lessonId = `${courseId}-1`;
  const words = Array.from({ length: WORDS }, (_, index) => wordOf(courseId, index));
  const texts = Array.from({ length: phrases }, (_, index) => ({
    id: phraseId(courseId, index),
    text: `${courseId} phrase number ${index} here`,
    translation: `${courseId}-фраза${index}`,
    createdAt: iso,
    updatedAt: iso,
  }));
  await database.transaction("rw", database.tables, async () => {
    await database.lessons.add({
      id: lessonId,
      courseId,
      title: lessonTitle(courseId, 1),
      completed: true,
      updatedAt: at,
    });
    await database.packages.add({
      lessonId,
      courseId,
      version: "1",
      schemaVersion: 4,
      installedAt: at,
      words: [],
      phrases: [],
      items: [],
      media: [],
    });
    await database.lessonItems.bulkAdd(
      words.map((word, position) => ({ lessonId, unitKey: wordKeyOf(word.id), ref: wordRef(word.id), position })),
    );
    await database.lessonItems.bulkAdd(
      texts.map((phrase, index) => ({
        lessonId,
        unitKey: unitKey(phraseRef(phrase.id)),
        ref: phraseRef(phrase.id),
        position: WORDS + index,
      })),
    );
    await database.words.bulkAdd(words.map(indexWord));
    await database.phrases.bulkAdd(texts);
    await database.cardStates.bulkAdd(words.slice(0, due).map((word) => dueState(word.id)));
  });
  await rememberCourses(database);
}
export const dueState = (id: string): LearningState => ({
  unitKey: wordKeyOf(id),
  ref: wordRef(id),
  introducedAt: "2026-10-01T09:00:00Z",
  version: 1,
  card: {
    ...createEmptyCard(new Date("2026-10-01T09:00:00Z")),
    due: new Date("2026-10-07T09:00:00Z"),
    state: State.Review,
    scheduled_days: 3,
    reps: 2,
  },
});
/** Незаконченное занятие из одного слова курса. */
export const activeOf = (id: string, courseId: string | undefined, extra: Partial<Session> = {}): Session => {
  const word = wordOf(courseId ?? "greek", 0);
  return {
    id,
    createdAt: extra.createdAt ?? iso,
    planDate: "2026-10-08",
    items: [
      {
        id: `${id}-0`,
        ref: wordRef(word.id),
        unitKey: unitKey(wordRef(word.id)),
        card: { kind: "word", word },
        type: "recognition",
        options: [],
        isNew: false,
        mode: "scheduled",
        expectedVersion: 1,
      },
    ],
    index: 0,
    status: "active",
    activeTimeMs: 0,
    ...(courseId ? { courseId } : {}),
    ...extra,
  };
};
