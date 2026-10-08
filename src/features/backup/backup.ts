import Dexie from "dexie";
import { exportDB, importInto } from "dexie-export-import";
import { AppDatabase, db, migrateV9, SCHEMA_VERSION, SYNC_META_PREFIX, TABLES } from "../../storage/db";
import { isAppDatabaseName } from "../../storage/profile";
import { DEFAULT_LANGUAGE, PROFILES } from "../../domain/language";
import { wordRef } from "../../domain/refs";
import { cardLanguages } from "../../storage/courses";
import { fillSettings, type LessonItem, type Settings } from "../../domain/types";
import { syncEvents } from "../../sync/events";
import { assertCloudUnchanged, type CloudGuard } from "./cloud-check";
import { courseProblem, type CourseRows } from "./course-check";

/** Версия формата копии совпадает с версией схемы; копия v8 читается через ту же миграцию, что и база. */
export const APP_MARKER = `tetradio:${SCHEMA_VERSION}`;
export const OLDEST_BACKUP = 8;
const KNOWN_MARKERS = [`tetradio:${OLDEST_BACKUP}`, APP_MARKER];
/** Пустые хранилища копий v8: в новой схеме их нет. */
const V8_STORES = ["lessonWords", "states", "baseSkills", "syncStash", "clozes"];
export interface BackupReport {
  databaseName: string;
  tables: { name: string; rows: number }[];
  createdAt: string | null;
  bytes: number;
  legacy: boolean;
}

/** Каталог — кеш, альтернативные версии облака и служебные ключи синхронизации — не данные пользователя: в копию не входят. */
export async function exportFull(database: AppDatabase = db): Promise<Blob> {
  await database.meta.put({ key: "app", value: APP_MARKER });
  await database.meta.put({ key: "exportedAt", value: new Date().toISOString() });
  const blob = await exportDB(database, {
    prettyJson: false,
    skipTables: ["catalog", "modules", "syncVersions"],
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
    "Этот клиент не поддерживает сохранение файлов из приложения. Откройте Τετράδιο там, где доступно сохранение, или сделайте копию позже.",
};
export const backupName = (now = new Date()) => `tetradio-backup-${now.toISOString().slice(0, 10)}.json`;

/** TSV — только слова: фразы и пропуски в него не входят, и полной копией он не является. */
export async function exportWordsTsv(database: AppDatabase = db): Promise<Blob> {
  const rows: string[] = [];
  let first = "";
  await database.words.orderBy("[sortKey+id]").each((word) => {
    first ||= word.id;
    rows.push([word.greek, word.russian, word.ipa].map((cell) => cell.replace(/[\t\r\n]/g, " ")).join("\t"));
  });
  // Шапка — по языку курса первого слова: одна на файл, даже если курсов несколько.
  const language = first ? (await cardLanguages([wordRef(first)], database)).values().next().value : undefined;
  const head = `${PROFILES[language ?? DEFAULT_LANGUAGE].names.title}\tРусский\tIPA`;
  return new Blob([[head, ...rows].join("\n")], { type: "text/tab-separated-values" });
}

const tableRows = (data: { tableName: string; rows?: unknown[] }[], name: string): unknown[] => {
  const rows = data.find((entry) => entry.tableName === name)?.rows;
  return Array.isArray(rows) ? rows : [];
};
const courseRowsOf = (data: { tableName: string; rows?: unknown[] }[]): CourseRows => ({
  lessons: tableRows(data, "lessons"),
  courses: tableRows(data, "courses"),
  packages: tableRows(data, "packages"),
  blockProgress: tableRows(data, "blockProgress"),
});

/** Предпросмотр проверяет то же, что восстановление до замены, кроме связей карточек: им нужна миграция копии v8. */
export async function inspectBackup(
  file: Blob,
  database: AppDatabase = db,
): Promise<{ ok: true; report: BackupReport } | { ok: false; message: string }> {
  let parsed: any;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, message: "Файл не читается как копия Τετράδιο — возможно, он повреждён." };
  }
  if (parsed?.formatName !== "dexie" || !parsed?.data?.tables)
    return { ok: false, message: "Это не файл полной копии Τετράδιο." };
  const info = parsed.data;
  if (!isAppDatabaseName(info.databaseName))
    return { ok: false, message: `Копия сделана другим приложением (база «${info.databaseName}»).` };
  const version = Number(info.databaseVersion);
  if (version > SCHEMA_VERSION)
    return {
      ok: false,
      message: `Копия сделана более новой версией Τετράδιο (схема ${info.databaseVersion}). Обновите приложение.`,
    };
  if (!(version >= OLDEST_BACKUP))
    return {
      ok: false,
      message: `Копия сделана слишком старой версией (схема ${info.databaseVersion}): восстанавливаются копии начиная со схемы ${OLDEST_BACKUP}.`,
    };
  const legacy = version < SCHEMA_VERSION;
  const names = info.tables.map((table: { name: string }) => table.name);
  const missing = TABLES.filter((table) => !names.includes(table));
  if (missing.length) return { ok: false, message: `В копии нет обязательных таблиц: ${missing.join(", ")}.` };
  const meta = (info.data ?? []).find((entry: { tableName: string }) => entry.tableName === "meta");
  const marker = (meta?.rows ?? []).find((row: { key: string }) => row.key === "app");
  if (marker && !KNOWN_MARKERS.includes(marker.value))
    return { ok: false, message: `Неизвестная версия формата копии: ${marker.value}.` };
  const exportedAt = (meta?.rows ?? []).find((row: { key: string }) => row.key === "exportedAt")?.value ?? null;
  if (!Array.isArray(info.data)) return { ok: false, message: "Копия повреждена: нет данных таблиц." };
  const problem = await courseProblem(courseRowsOf(info.data), database);
  if (problem) return { ok: false, message: problem };
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
 * Копия сначала разворачивается в отдельной базе, копия v8 мигрируется по тем же правилам, что и локальная база,
 * и проверяется на целостность; только затем одной транзакцией заменяет данные. Копия только с прогрессом курса
 * (без карточек) допустима, пустая — нет; связь с отсутствующей карточкой или уроком отклоняет восстановление до замены.
 * `cloud` — отпечаток облака из предпросмотра: изменившееся с тех пор облако останавливает замену.
 */
export async function restoreBackup(
  file: Blob,
  database: AppDatabase = db,
  options: { cloud?: CloudGuard } = {},
): Promise<void> {
  const check = await inspectBackup(file, database);
  if (!check.ok) throw new Error(check.message);
  const staging = new AppDatabase("tetradio-restore");
  await staging.delete();
  await staging.open();
  try {
    await importInto(staging, file, {
      acceptNameDiff: true,
      acceptVersionDiff: true,
      clearTablesBeforeImport: true,
      overwriteValues: true,
      skipTables: V8_STORES,
    });
    if (check.report.legacy)
      await staging.transaction(
        "rw",
        TABLES.map((name) => staging.table(name)),
        () => migrateV9(staging),
      );
    const payload = await Promise.all(TABLES.map(async (name) => [name, await staging.table(name).toArray()] as const));
    const rows = <T>(name: (typeof TABLES)[number]) => payload.find(([table]) => table === name)![1] as T[];
    const ids = (name: "words" | "phrases") => new Set(rows<{ id: string }>(name).map((row) => row.id));
    const cards = { word: ids("words"), phrase: ids("phrases") };
    const courseProgress =
      rows("blockProgress").length > 0 || rows<{ completed?: boolean }>("lessons").some((row) => row.completed);
    if (!cards.word.size && !cards.phrase.size && !courseProgress)
      throw new Error("В копии нет ни карточек, ни прогресса курса — восстанавливать нечего.");
    const course = await courseProblem(
      {
        lessons: rows("lessons"),
        courses: rows("courses"),
        packages: rows("packages"),
        blockProgress: rows("blockProgress"),
      },
      database,
    );
    if (course) throw new Error(course);
    const lessonIds = new Set(rows<{ id: string }>("lessons").map((lesson) => lesson.id));
    const broken = rows<LessonItem>("lessonItems").find(
      (link) => !link.ref || !cards[link.ref.kind]?.has(link.ref.id) || !lessonIds.has(link.lessonId),
    );
    if (broken) throw new Error(`Копия повреждена: связь урока ${broken.lessonId} указывает на несуществующую запись.`);
    // Сверка — последний шаг перед заменой: защитная копия и разворот файла могли занять заметное время.
    await assertCloudUnchanged(options.cloud);
    await database.transaction(
      "rw",
      TABLES.map((name) => database.table(name)),
      async () => {
        // Идентификатор устройства и очередь публикации принадлежат этой установке, а не копии.
        const own = await database.meta.where("key").startsWith(SYNC_META_PREFIX).toArray();
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
    await Dexie.delete("tetradio-restore");
  }
}
