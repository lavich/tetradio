import { db, indexWord, type AppDatabase } from "../storage/db";
import { adoptStash } from "../sync/snapshot";
import { unitKey } from "../domain/refs";
import { CARD_KINDS, type InstalledPackage, type LearningRef, type Phrase, type Word } from "../domain/types";
import { STORED_KINDS } from "../storage/kinds";
import {
  SHIPPED_FIELDS,
  paradigmsOf,
  voicedOf,
  type ContentPackage,
  type PackagePhrase,
  type PackageWord,
  type ShippedField,
} from "./schema";

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
 * Карточка той же ревизии не перезаписывается, если в ней нет поля, которое версия приложения не знала (`missing`).
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
  missing: (card: P, stored: L) => boolean = () => false,
) {
  const local = await table.bulkGet(incoming.map((card) => card.id));
  const rows: L[] = [];
  incoming.forEach((card, index) => {
    const stored = local[index];
    if (stored?.revision === card.revision && !missing(card, stored)) return;
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
      if (
        installed &&
        installed.version === pack.version &&
        (installed.readings?.length ?? 0) >= (pack.readings?.length ?? 0) &&
        voicedOf(installed.readings) >= voicedOf(pack.readings) &&
        paradigmsOf(installed.words) >= paradigmsOf(pack.words)
      )
        return { status: "current", added: 0, changed: 0 };
      const result: InstallResult = { status: installed ? "updated" : "installed", added: 0, changed: 0 };
      if (!known)
        await database.lessons.add({
          id: pack.id,
          courseId: pack.courseId || undefined,
          title: pack.lesson.title,
          completed: false,
          updatedAt: now,
        });
      await applyCards(
        pack.words,
        database.words,
        (card, at) => indexWord(wordFromPackage(card, at)),
        now,
        result,
        (card, stored) => !!card.paradigm && !stored.paradigm,
      );
      await applyCards(pack.phrases, database.phrases, phraseFromPackage, now, result);
      const links = pack.items.map((item) => {
        const ref: LearningRef = { kind: item.kind, id: item.id };
        return { lessonId: pack.id, unitKey: unitKey(ref), ref, position: item.position };
      });
      await database.lessonItems.bulkPut(links);
      const incoming = new Set(links.map((link) => link.unitKey));
      /**
       * Состав урока принадлежит автору: карточка, исчезнувшая из новой версии, теряет связь с уроком.
       * Сама карточка, её прогресс и история остаются — она может жить в других уроках и в словаре.
       */
      const gone = (installed?.items ?? [])
        .map((item) => unitKey({ kind: item.kind, id: item.id }))
        .filter((key) => !incoming.has(key));
      if (gone.length) await database.lessonItems.bulkDelete(gone.map((key): [string, string] => [pack.id, key]));
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
      if (pack.readings) record.readings = pack.readings;
      await database.packages.put(record);
      // Полученный из облака прогресс карточек этого пакета ждал установки: теперь он становится обычным состоянием.
      await adoptStash(
        database,
        pack.id,
        CARD_KINDS.flatMap((kind) => STORED_KINDS[kind].packageIds(pack).map((id) => ({ kind, id }))),
      );
      return result;
    },
  );
}
