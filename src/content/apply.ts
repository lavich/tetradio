import { db, indexWord, type AppDatabase } from "../storage/db";
import { adoptStash } from "../sync/snapshot";
import { unitKey, wordRef } from "../domain/refs";
import type { InstalledPackage, LearningRef, Phrase, Word } from "../domain/types";
import { SHIPPED_FIELDS, type ContentPackage, type PackagePhrase, type PackageWord, type ShippedField } from "./schema";

export interface InstallResult {
  status: "installed" | "updated" | "current";
  added: number;
  changed: number;
}

const shipped = (word: PackageWord) =>
  Object.fromEntries(
    SHIPPED_FIELDS.filter((field) => word[field] !== undefined).map((field) => [field, word[field]]),
  ) as Pick<Word, ShippedField>;
/** Поставляемое слово в виде локальной записи: так его ставит установка и показывает просмотр без установки. */
export const wordFromPackage = (card: PackageWord, at: string): Word => ({
  ...shipped(card),
  id: card.id,
  createdAt: at,
  updatedAt: at,
  revision: card.revision,
});

/** Поставляемая фраза в виде локальной записи: происхождение остаётся в пакете. */
const phraseFromPackage = (card: PackagePhrase, at: string): Phrase => {
  const { revision, provenance: _provenance, ...rest } = card;
  return { ...rest, createdAt: at, updatedAt: at, revision };
};

/**
 * Карточки принадлежат пакету: новая ревизия перезаписывает поставляемые поля целиком, `createdAt` остаётся.
 * Карточка той же ревизии не перезаписывается.
 */
async function applyCards<
  P extends { id: string; revision: string },
  L extends { createdAt: string; revision?: string },
>(
  incoming: P[],
  table: { bulkGet(ids: string[]): Promise<(L | undefined)[]>; bulkPut(rows: L[]): Promise<unknown> },
  build: (card: P, at: string) => L,
  now: string,
  result: InstallResult,
) {
  const local = await table.bulkGet(incoming.map((card) => card.id));
  const rows: L[] = [];
  incoming.forEach((card, index) => {
    const stored = local[index];
    if (stored?.revision === card.revision) return;
    const row = build(card, now);
    if (stored) {
      result.changed++;
      rows.push({ ...row, createdAt: stored.createdAt });
    } else {
      result.added++;
      rows.push(row);
    }
  });
  await table.bulkPut(rows);
}

/**
 * Установка одной транзакцией: слова, фразы, связи, медиа и запись пакета. Ошибка в любой карточке
 * откатывает всё — корректная часть отдельно не устанавливается.
 */
export async function applyPackage(pack: ContentPackage, database: AppDatabase = db): Promise<InstallResult> {
  const now = new Date().toISOString();
  return database.transaction(
    "rw",
    [
      database.words,
      database.phrases,
      database.lessons,
      database.lessonItems,
      database.packages,
      database.media,
      database.cardStates,
      database.cardStash,
      database.meta,
    ],
    async () => {
      const installed = await database.packages.get(pack.id);
      // Курс дописывается и на неизменной версии: у базы, пережившей переход на курсы, его ещё нет.
      const known = await database.lessons.get(pack.id);
      if (known && !known.courseId && pack.courseId) await database.lessons.put({ ...known, courseId: pack.courseId });
      if (installed && installed.version === pack.version) return { status: "current", added: 0, changed: 0 };
      const result: InstallResult = { status: installed ? "updated" : "installed", added: 0, changed: 0 };
      if (!known)
        await database.lessons.add({
          id: pack.id,
          courseId: pack.courseId || undefined,
          title: pack.lesson.title,
          completed: false,
          updatedAt: now,
        });
      await applyCards(pack.words, database.words, (card, at) => indexWord(wordFromPackage(card, at)), now, result);
      await applyCards(pack.phrases, database.phrases, phraseFromPackage, now, result);
      const incoming = new Set<string>();
      for (const item of pack.items) {
        const ref: LearningRef = { kind: item.kind, id: item.id };
        const key = unitKey(ref);
        incoming.add(key);
        await database.lessonItems.put({ lessonId: pack.id, unitKey: key, ref, position: item.position });
      }
      /**
       * Состав урока принадлежит автору: карточка, исчезнувшая из новой версии, теряет связь с уроком.
       * Сама карточка, её прогресс и история остаются — она может жить в других уроках и в словаре.
       */
      for (const item of installed?.items ?? []) {
        const key = unitKey({ kind: item.kind, id: item.id });
        if (!incoming.has(key)) await database.lessonItems.delete([pack.id, key]);
      }
      await database.media.bulkPut(pack.media);
      const record: InstalledPackage = {
        lessonId: pack.id,
        courseId: pack.courseId || undefined,
        version: pack.version,
        schemaVersion: pack.schemaVersion,
        installedAt: now,
        words: pack.words,
        phrases: pack.phrases,
        items: pack.items,
        media: pack.media,
      };
      if (pack.lesson.kind) record.kind = pack.lesson.kind;
      if (pack.module) record.module = pack.module;
      if (pack.blocks) record.blocks = pack.blocks;
      if (pack.marks) record.marks = pack.marks;
      await database.packages.put(record);
      // Полученный из облака прогресс карточек этого пакета ждал установки: теперь он становится обычным состоянием.
      await adoptStash(database, pack.id, [
        ...pack.words.map((word) => wordRef(word.id)),
        ...pack.phrases.map((p) => ({ kind: "phrase" as const, id: p.id })),
      ]);
      return result;
    },
  );
}
