import type { CardFacts } from "../domain/kinds";
import type { CardKind, InstalledPackage, SessionCard } from "../domain/types";
import type { AppDatabase } from "./db";
import { zoned } from "./zone";

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
}

type PackageCards = Pick<InstalledPackage, "words" | "phrases">;

const word: StoredKind = {
  tables: ["words"],
  presentIds: zoned(async (ids, database) => (await database.words.where("id").anyOf(ids).primaryKeys()) as string[]),
  contents: zoned(async (ids, database) =>
    (await database.words.bulkGet(ids)).flatMap((card) => (card ? [{ kind: "word" as const, word: card }] : [])),
  ),
  facts: zoned(async (ids) => new Map(ids.map((id) => [id, { kind: "word" as const }]))),
  count: (database) => database.words.count(),
  packageIds: (pack) => pack.words.map((card) => card.id),
};
const phrase: StoredKind = {
  tables: ["phrases"],
  presentIds: zoned(async (ids, database) => (await database.phrases.where("id").anyOf(ids).primaryKeys()) as string[]),
  contents: zoned(async (ids, database) =>
    (await database.phrases.bulkGet(ids)).flatMap((card) => (card ? [{ kind: "phrase" as const, phrase: card }] : [])),
  ),
  // Признаки фразы лежат в её записи; читаются только записи кандидатов, а не таблица целиком.
  facts: zoned(
    async (ids, database) =>
      new Map(
        (await database.phrases.bulkGet(ids)).flatMap((card) =>
          card
            ? [
                [
                  card.id,
                  { kind: "phrase" as const, hasTranslation: !!card.translation, hasAudio: !!card.audioAssetId },
                ],
              ]
            : [],
        ),
      ),
  ),
  count: (database) => database.phrases.count(),
  packageIds: (pack) => pack.phrases.map((card) => card.id),
};

/** Ошибки урока больше не создаются; состояния прежних версий лежат как есть, без содержимого и без связи с пакетом. */
const mistake: StoredKind = {
  tables: [],
  presentIds: async (ids) => ids,
  contents: async () => [],
  facts: async (ids) => new Map(ids.map((id) => [id, { kind: "mistake" as const }])),
  count: async () => 0,
  packageIds: () => [],
};

export const STORED_KINDS: Record<CardKind, StoredKind> = { word, phrase, mistake };
export const CONTENT_TABLES = [...new Set(Object.values(STORED_KINDS).flatMap((kind) => kind.tables))];
