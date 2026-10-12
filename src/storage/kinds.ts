import type { CardFacts } from "../domain/kinds";
import type { ExerciseBlock, LessonBlock } from "../content/course";
import type { CardKind, InstalledPackage, MistakeItem, SessionCard } from "../domain/types";
import type { AppDatabase } from "./db";
import { lessonCourses } from "./lesson-courses";

/**
 * Хранение вида карточки: где лежит содержимое и как его читать. Пара к `KINDS` домена;
 * признаки доступности здесь без языка — язык добавляет выборка по курсу карточки.
 */
export interface StoredKind {
  /** Таблицы, из которых читаются наличие и содержимое: их открывают транзакции синхронизации. */
  tables: readonly string[];
  /** Идентификаторы из перечисленных, у которых есть содержимое на устройстве; тексты не читаются. */
  presentIds(ids: string[], database: AppDatabase): Promise<string[]>;
  contents(ids: string[], database: AppDatabase): Promise<SessionCard[]>;
  facts(ids: string[], database: AppDatabase): Promise<Map<string, Omit<CardFacts, "language">>>;
  count(database: AppDatabase): Promise<number>;
  /** Карточки вида, которые ставит пакет урока. */
  packageIds(pack: PackageCards): string[];
  /** Курс карточек вида, у которых нет связей с уроками; без него курс берётся из связей `lessonItems`. */
  coursesOf?: (ids: string[], database: AppDatabase) => Promise<Map<string, string>>;
}

type PackageCards = Pick<InstalledPackage, "words" | "phrases"> & { id: string; blocks?: LessonBlock[] };

const word: StoredKind = {
  tables: ["words"],
  presentIds: async (ids, database) => (await database.words.where("id").anyOf(ids).primaryKeys()) as string[],
  contents: async (ids, database) =>
    (await database.words.bulkGet(ids)).flatMap((card) => (card ? [{ kind: "word" as const, word: card }] : [])),
  facts: async (ids) => new Map(ids.map((id) => [id, { kind: "word" as const }])),
  count: (database) => database.words.count(),
  packageIds: (pack) => pack.words.map((card) => card.id),
};
const phrase: StoredKind = {
  tables: ["phrases"],
  presentIds: async (ids, database) => (await database.phrases.where("id").anyOf(ids).primaryKeys()) as string[],
  contents: async (ids, database) =>
    (await database.phrases.bulkGet(ids)).flatMap((card) => (card ? [{ kind: "phrase" as const, phrase: card }] : [])),
  // Признаки фразы лежат в её записи; читаются только записи кандидатов, а не таблица целиком.
  facts: async (ids, database) =>
    new Map(
      (await database.phrases.bulkGet(ids)).flatMap((card) =>
        card
          ? [[card.id, { kind: "phrase" as const, hasTranslation: !!card.translation, hasAudio: !!card.audioAssetId }]]
          : [],
      ),
    ),
  count: (database) => database.phrases.count(),
  packageIds: (pack) => pack.phrases.map((card) => card.id),
};

/** Задания к чтению и аудированию без текста не решить: их пункты в повторение не идут. */
const reviewable = (block: LessonBlock): block is ExerciseBlock => block.type === "exercise" && !block.about;
const mistakeId = (lessonId: string, blockId: string, itemId: string) => `${lessonId}/${blockId}/${itemId}`;
/** Пункты по идентификаторам из установленных пакетов; убранного пункта в ответе нет. */
async function mistakeItems(ids: string[], database: AppDatabase): Promise<Map<string, MistakeItem>> {
  const wanted = new Set(ids);
  const lessonIds = [...new Set(ids.map((id) => id.split("/")[0]))];
  const items = new Map<string, MistakeItem>();
  for (const pack of await database.packages.bulkGet(lessonIds)) {
    for (const block of pack?.blocks ?? []) {
      if (!pack || !reviewable(block)) continue;
      for (const item of block.items) {
        const id = mistakeId(pack.lessonId, block.id, item.id);
        if (!wanted.has(id)) continue;
        items.set(id, {
          id,
          lessonId: pack.lessonId,
          format: block.format,
          instruction: block.instruction,
          prompt: item.prompt,
          ...(block.format === "choice" ? { options: item.options } : block.bank ? { options: block.bank } : {}),
          answer: item.answer,
          ...(item.explanation ? { explanation: item.explanation } : {}),
          ...(item.audioAssetId ? { audioAssetId: item.audioAssetId } : {}),
        });
      }
    }
  }
  return items;
}
const mistake: StoredKind = {
  tables: ["packages"],
  presentIds: async (ids, database) => [...(await mistakeItems(ids, database)).keys()],
  contents: async (ids, database) =>
    [...(await mistakeItems(ids, database)).values()].map((item) => ({ kind: "mistake" as const, mistake: item })),
  facts: async (ids) => new Map(ids.map((id) => [id, { kind: "mistake" as const }])),
  count: (database) => database.cardStates.where("ref.kind").equals("mistake").count(),
  packageIds: (pack) =>
    (pack.blocks ?? [])
      .filter(reviewable)
      .flatMap((block) => block.items.map((item) => mistakeId(pack.id, block.id, item.id))),
  // Курс ошибки — курс её урока: связей с уроками в `lessonItems` у неё нет.
  coursesOf: async (ids, database) => {
    const courses = await lessonCourses(
      ids.map((id) => id.split("/")[0]),
      database,
    );
    return new Map(ids.flatMap((id) => (courses.has(id.split("/")[0]) ? [[id, courses.get(id.split("/")[0])!]] : [])));
  },
};

export const STORED_KINDS: Record<CardKind, StoredKind> = { word, phrase, mistake };
export const CONTENT_TABLES = [...new Set(Object.values(STORED_KINDS).flatMap((kind) => kind.tables))];
