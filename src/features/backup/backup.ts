import Dexie from "dexie";
import { exportDB, importInto } from "dexie-export-import";
import {
  LexiDatabase,
  db,
  LEGACY_STORES,
  LEGACY_TABLES,
  migrateCards,
  migrateDropCloze,
  migrateCourses,
  migrateCourseTempo,
  migrateLegacy,
  SCHEMA_VERSION,
  SYNC_META_PREFIX,
  TABLES,
  TABLES_V2,
  TABLES_V3,
  TABLES_V5,
} from "../../storage/db";
import { isLexiDatabaseName } from "../../storage/profile";
import { fillSettings, type LessonItem, type Settings } from "../../domain/types";
import { syncEvents } from "../../sync/events";

/** Версия формата копии совпадает с версией схемы; копии прежних версий читаются через ту же миграцию, что и база. */
export const APP_MARKER = `lexi:${SCHEMA_VERSION}`;
const KNOWN_MARKERS = Array.from({ length: SCHEMA_VERSION }, (_, index) => `lexi:${index + 1}`);
export interface BackupReport {
  databaseName: string;
  tables: { name: string; rows: number }[];
  createdAt: string | null;
  bytes: number;
  legacy: boolean;
}

/** Обязательные таблицы копии по версии её схемы: старый файл не обязан знать новые таблицы. */
export function requiredTables(version: number): readonly string[] {
  if (version < 2) return LEGACY_TABLES;
  if (version < 3) return TABLES_V2;
  if (version < 4) return TABLES_V3;
  if (version < 6) return TABLES_V5;
  return TABLES;
}

/** Каталог — кеш, альтернативные версии облака, пустые площадки старых хранилищ и служебные ключи синхронизации — не данные пользователя: в копию не входят. */
export async function exportFull(database: LexiDatabase = db): Promise<Blob> {
  await database.meta.put({ key: "app", value: APP_MARKER });
  await database.meta.put({ key: "exportedAt", value: new Date().toISOString() });
  const blob = await exportDB(database, {
    prettyJson: false,
    skipTables: ["catalog", "syncVersions", ...LEGACY_STORES],
    filter: (table, value) =>
      !(table === "meta" && String((value as { key?: string })?.key ?? "").startsWith(SYNC_META_PREFIX)),
  });
  return new Blob([blob], { type: "application/json" });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/**
 * Итог передачи файла. «shared»/«downloaded» означают, что файл передан системе, а не что он сохранён:
 * браузер не сообщает о фактическом сохранении, поэтому интерфейс говорит нейтрально.
 */
export type TransferOutcome = "shared" | "downloaded" | "cancelled" | "failed" | "unsupported";
export interface TransferPorts {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  download?: (blob: Blob, name: string) => void;
  downloadSupported?: boolean;
}
const defaultPorts = (): TransferPorts => ({
  canShare:
    typeof navigator !== "undefined" && typeof navigator.canShare === "function"
      ? (data) => navigator.canShare(data)
      : undefined,
  share:
    typeof navigator !== "undefined" && typeof navigator.share === "function"
      ? (data) => navigator.share(data)
      : undefined,
  download,
  downloadSupported: typeof document !== "undefined" && "download" in document.createElement("a"),
});
/**
 * Файловый share предпочтителен в WebView, где ссылка на Blob может не сработать; иначе обычное скачивание.
 * Отмена диалога отличается от ошибки и не считается сохранением.
 */
export async function transferFile(
  blob: Blob,
  name: string,
  ports: TransferPorts = defaultPorts(),
): Promise<TransferOutcome> {
  const file = new File([blob], name, { type: blob.type || "application/json" });
  if (ports.share && ports.canShare?.({ files: [file] })) {
    try {
      await ports.share({ files: [file], title: name });
      return "shared";
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return "cancelled";
      if (!ports.downloadSupported || !ports.download) return "failed";
    }
  }
  if (!ports.downloadSupported || !ports.download) return "unsupported";
  try {
    ports.download(blob, name);
    return "downloaded";
  } catch {
    return "failed";
  }
}
export const TRANSFER_TEXT: Record<TransferOutcome, string> = {
  shared: "Файл передан выбранному приложению. Проверьте, что он сохранился там.",
  downloaded: "Файл передан браузеру для сохранения. Проверьте папку загрузок.",
  cancelled: "Передача отменена. Данные не изменились.",
  failed: "Не удалось передать файл. Данные не изменились.",
  unsupported:
    "Этот клиент не поддерживает сохранение файлов из приложения. Откройте Lexi там, где доступно сохранение, или сделайте копию позже.",
};
export const backupName = (now = new Date()) => `lexi-backup-${now.toISOString().slice(0, 10)}.json`;

/** TSV — только слова: фразы и пропуски в него не входят, и полной копией он не является. */
export async function exportWordsTsv(database: LexiDatabase = db): Promise<Blob> {
  const rows: string[] = ["Греческий\tРусский\tIPA"];
  await database.words.orderBy("[sortKey+id]").each((word) => {
    if (!word.deletedAt)
      rows.push([word.greek, word.russian, word.ipa].map((cell) => cell.replace(/[\t\r\n]/g, " ")).join("\t"));
  });
  return new Blob([rows.join("\n")], { type: "text/tab-separated-values" });
}

export async function inspectBackup(
  file: Blob,
): Promise<{ ok: true; report: BackupReport } | { ok: false; message: string }> {
  let parsed: any;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, message: "Файл не читается как копия Lexi — возможно, он повреждён." };
  }
  if (parsed?.formatName !== "dexie" || !parsed?.data?.tables)
    return { ok: false, message: "Это не файл полной копии Lexi." };
  const info = parsed.data;
  if (!isLexiDatabaseName(info.databaseName))
    return { ok: false, message: `Копия сделана другим приложением (база «${info.databaseName}»).` };
  const version = Number(info.databaseVersion);
  if (version > SCHEMA_VERSION)
    return {
      ok: false,
      message: `Копия сделана более новой версией Lexi (схема ${info.databaseVersion}). Обновите приложение.`,
    };
  const legacy = version < SCHEMA_VERSION;
  const names = info.tables.map((table: { name: string }) => table.name);
  const missing = requiredTables(version).filter((table) => !names.includes(table));
  if (missing.length) return { ok: false, message: `В копии нет обязательных таблиц: ${missing.join(", ")}.` };
  const meta = (info.data ?? []).find((entry: { tableName: string }) => entry.tableName === "meta");
  const marker = (meta?.rows ?? []).find((row: { key: string }) => row.key === "app");
  if (marker && !KNOWN_MARKERS.includes(marker.value))
    return { ok: false, message: `Неизвестная версия формата копии: ${marker.value}.` };
  const exportedAt = (meta?.rows ?? []).find((row: { key: string }) => row.key === "exportedAt")?.value ?? null;
  return {
    ok: true,
    report: {
      databaseName: info.databaseName,
      tables: info.tables.map((table: { name: string; rowCount: number }) => ({
        name: table.name,
        rows: table.rowCount,
      })),
      createdAt: exportedAt,
      bytes: file.size,
      legacy,
    },
  };
}

/**
 * Копия сначала разворачивается в отдельной базе, мигрируется по тем же правилам, что и локальная схема,
 * и проверяется на целостность; только затем одной транзакцией заменяет данные. Копия с фразами или пропусками
 * без слов допустима; связь с отсутствующей карточкой любого вида отклоняет восстановление до замены.
 */
export async function restoreBackup(file: Blob, database: LexiDatabase = db): Promise<void> {
  const check = await inspectBackup(file);
  if (!check.ok) throw new Error(check.message);
  const staging = new LexiDatabase("lexi-restore");
  await staging.delete();
  await staging.open();
  try {
    await importInto(staging, file, {
      acceptNameDiff: true,
      acceptVersionDiff: true,
      clearTablesBeforeImport: true,
      overwriteValues: true,
    });
    const all = [...TABLES, ...LEGACY_STORES, "syncVersions"].map((name) => staging.table(name));
    await staging.transaction("rw", all, () => migrateLegacy(staging));
    // Копия прежнего формата курсов не знает: восстановленный профиль получает их тем же переходом, что и миграция базы.
    await staging.transaction("rw", all, async () => {
      await migrateCourses(staging);
      await migrateCourseTempo(staging);
    });
    // Словарные ключи старых копий переезжают в типизированные хранилища; для копии схемы 6 шаг ничего не делает.
    await staging.transaction("rw", all, () => migrateCards(staging));
    // Копия схемы ≤6 знает снятый вид карточек: он уходит тем же переходом, что и в локальном профиле.
    await staging.transaction("rw", all, () => migrateDropCloze(staging));
    const payload = await Promise.all(TABLES.map(async (name) => [name, await staging.table(name).toArray()] as const));
    const rows = <T>(name: (typeof TABLES)[number]) => payload.find(([table]) => table === name)![1] as T[];
    const ids = (name: "words" | "phrases") => new Set(rows<{ id: string }>(name).map((row) => row.id));
    const cards = { word: ids("words"), phrase: ids("phrases") };
    if (!cards.word.size && !cards.phrase.size)
      throw new Error("В копии нет ни одной карточки — восстановление отменено.");
    const lessonIds = new Set(rows<{ id: string }>("lessons").map((lesson) => lesson.id));
    const broken = rows<LessonItem>("lessonItems").find(
      (link) => !link.ref || !cards[link.ref.kind]?.has(link.ref.id) || !lessonIds.has(link.lessonId),
    );
    if (broken) throw new Error(`Копия повреждена: связь урока ${broken.lessonId} указывает на несуществующую запись.`);
    await database.transaction(
      "rw",
      [...TABLES, ...LEGACY_STORES].map((name) => database.table(name)),
      async () => {
        // Идентификатор устройства и очередь публикации принадлежат этой установке, а не копии.
        const own = await database.meta.where("key").startsWith(SYNC_META_PREFIX).toArray();
        for (const name of LEGACY_STORES) await database.table(name).clear();
        for (const [name, items] of payload) {
          await database.table(name).clear();
          const rows =
            name === "settings"
              ? (items as Settings[]).map(fillSettings)
              : name === "meta"
                ? (items as { key: string }[]).filter((row) => !row.key.startsWith(SYNC_META_PREFIX))
                : items;
          await database.table(name).bulkAdd(rows as never[]);
        }
        await database.meta.bulkPut(own);
        // Восстановленная копия не заменяет облако молча: следующий обмен предложит выбор состояния.
        await database.meta.put({ key: `${SYNC_META_PREFIX}restored`, value: new Date().toISOString() });
      },
    );
    syncEvents.emit("restored");
  } finally {
    staging.close();
    await Dexie.delete("lexi-restore");
  }
}
