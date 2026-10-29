import { decodeSnapshot, encodeSnapshot, SnapshotFormatError } from "./codec";
import { SyncError, validKey, type KeyValueTransport } from "./transport";
import {
  SNAPSHOT_FORMAT,
  SUPPORTED_SNAPSHOT_FORMATS,
  type Clock,
  type CompactSnapshot,
  type VersionMeta,
} from "./types";

/**
 * Адаптер синхронизации: чтение и публикация целых версий поверх транспорта «ключ → строка».
 * Telegram-специфика (имена ключей, разбиение на части, callback API) не выходит за его границу.
 * Контракт не обещает общей блокировки или compare-and-swap: каждое устройство пишет только свои ключи —
 * неизменяемые части поколения и собственный указатель, который публикуется последним.
 */
export interface SyncCapabilities {
  available: boolean;
  maxKeys: number;
  maxValueLength: number;
}
export interface PointerListing {
  pointers: VersionMeta[];
  invalid: string[];
  keys: number;
  /** Имена ключей облака на момент чтения: публикация сразу после чтения не перечитывает их. */
  names?: string[];
  /** Версии, у указателя которых в облаке нет всех частей. */
  incomplete: string[];
}
export interface PublishOptions {
  /** Ключи облака, только что прочитанные решением: без них место считается по свежему списку. */
  keys?: string[];
  /** Готовый указатель и записываемый текст до записи частей: координатор запоминает начатую публикацию. */
  beforeWrite?: (meta: VersionMeta, text: string) => Promise<void>;
}
export interface PublishedVersion {
  meta: VersionMeta;
  /** Длина записанного текста всех частей. */
  chars: number;
}
export interface SyncAdapter {
  capabilities(): SyncCapabilities;
  listPointers(): Promise<PointerListing>;
  readVersion(meta: VersionMeta): Promise<CompactSnapshot>;
  /** Снимок и текст версии, как он лежит в облаке: звено цепочки предков хранит тот же текст. */
  readVersionText?(meta: VersionMeta): Promise<{ snapshot: CompactSnapshot; text: string }>;
  /** Идемпотентно: повтор той же версии перезаписывает те же части и указатель. */
  /** Формат записи — `meta.format`: 5 пишется JSON, 6 — упакованным; другой — отказ `format`. */
  publishVersion(
    meta: Omit<VersionMeta, "parts" | "checksum" | "content">,
    snapshot: CompactSnapshot,
    options?: PublishOptions,
  ): Promise<PublishedVersion>;
  /**
   * Меняет в собственном указателе версии `id` только поле `reads`, остальные поля сырого значения сохраняются.
   * `false` — указатель уже другой или частей версии нет; если части пропали во время записи, указатель удаляется.
   */
  declareReads(device: string, id: string, reads: number[]): Promise<boolean>;
  /** Идентификаторы версий, части которых лежат в облаке (включая незавершённые публикации). */
  listGenerations(): Promise<string[]>;
  /** Удаляет части перечисленных версий; указатели других устройств не трогает. */
  removeGenerations(versionIds: string[]): Promise<void>;
  /**
   * Удаляет указатель другого устройства и части его версий не новее указателя, если указатель всё ещё тот же;
   * `false` — устройство успело опубликовать другую версию, ничего не удалено.
   */
  removeDevice(meta: VersionMeta): Promise<boolean>;
  /** Сколько ключей займёт версия и сколько свободно с учётом собственного указателя. */
  room(
    partsNeeded: number,
    ownDevice: string,
    keys?: string[],
  ): Promise<{ free: number; needed: number; keys: number }>;
  /**
   * Паузы курсов — отдельно от версий: ключ `cp_<устройство>` на устройство, пишет его только оно само. Значения по
   * устройствам; ключей версий и указателей эти методы не касаются.
   */
  listCoursePauses?(): Promise<Record<string, string>>;
  writeCoursePauses?(device: string, value: string): Promise<void>;
  /** Удаляет ключ пауз устройства, если он всё ещё `expected`; `false` — устройство успело его переписать. */
  removeCoursePauses?(device: string, expected: string): Promise<boolean>;
}
export const PART_SIZE = 4000;
const WRITABLE_FORMATS = [5, 6];
const PACKED_FORMAT = 6;
const POINTER = "p_",
  PART = "v_",
  PAUSES = "cp_";
/** Не совпадает с указателем (`p_` в начале) и частью (`v_…_n`): прежние сборки ключ не читают и не убирают. */
export const pausesKey = (device: string) => `${PAUSES}${device}`;
export const pointerKey = (device: string) => `${POINTER}${device}`;
export const partKey = (versionId: string, index: number) => `${PART}${versionId}_${index}`;
export const parsePartKey = (key: string): { versionId: string; index: number } | null => {
  const match = /^v_(.+)_(\d+)$/.exec(key);
  return match ? { versionId: match[1], index: Number(match[2]) } : null;
};
/** Идентификатор версии — `устройство-счётчик`: счётчик устройства в её часах. */
const parseVersionId = (id: string): { device: string; counter: number } | null => {
  const match = /^(.+)-(\d+)$/.exec(id);
  return match ? { device: match[1], counter: Number(match[2]) } : null;
};
/** FNV-1a 32 бита: достаточно для проверки целостности частей, криптостойкость не требуется. */
export function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
export const splitParts = (text: string, size = PART_SIZE) => {
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += size) parts.push(text.slice(index, index + size));
  return parts.length ? parts : [""];
};
const isClock = (value: unknown): value is Clock =>
  !!value && typeof value === "object" && Object.values(value as object).every((count) => typeof count === "number");
export function parsePointer(raw: string): VersionMeta | null {
  try {
    const meta = JSON.parse(raw);
    if (
      typeof meta?.id !== "string" ||
      typeof meta.device !== "string" ||
      !isClock(meta.clock) ||
      typeof meta.parts !== "number" ||
      typeof meta.checksum !== "string" ||
      typeof meta.format !== "number"
    )
      return null;
    return {
      id: meta.id,
      device: meta.device,
      clock: meta.clock,
      createdAt: String(meta.createdAt ?? ""),
      format: meta.format,
      parts: meta.parts,
      checksum: meta.checksum,
      content: typeof meta.content === "string" ? meta.content : undefined,
      resolves: Array.isArray(meta.resolves) ? meta.resolves.filter((item: unknown) => typeof item === "string") : [],
      label: typeof meta.label === "string" ? meta.label : undefined,
      reads:
        Array.isArray(meta.reads) && meta.reads.every((format: unknown) => typeof format === "number")
          ? meta.reads
          : undefined,
    };
  } catch {
    return null;
  }
}

let compressionModule: Promise<typeof import("./compression")> | null = null;
/**
 * Чанк упаковки отдельный и грузится по требованию. После деплоя WebView без service worker держит старую сборку,
 * чей чанк уже удалён: отказ — `stale` (нужна перезагрузка), а промис сбрасывается, чтобы повтор грузил заново.
 */
export function loadCompression() {
  compressionModule ??= import("./compression").catch((error: unknown) => {
    compressionModule = null;
    throw new SyncError(
      "stale",
      "Не удалось загрузить часть приложения: вышла новая версия. Перезапустите приложение.",
      error,
    );
  });
  return compressionModule;
}
const compression = loadCompression;
const unpacksTo = (unpack: (text: string) => string, text: string, json: string) => {
  try {
    return unpack(text) === json;
  } catch {
    return false;
  }
};

export function kvAdapter(transport: KeyValueTransport): SyncAdapter {
  const limits = transport.limits;
  const partSize = Math.min(PART_SIZE, limits.maxValueLength);
  const ensure = () => {
    if (!transport.available()) throw new SyncError("unavailable", "Облачное хранилище недоступно в этом клиенте.");
  };
  return {
    capabilities: () => ({
      available: transport.available(),
      maxKeys: limits.maxKeys,
      maxValueLength: limits.maxValueLength,
    }),
    async listPointers() {
      ensure();
      const keys = await transport.getKeys();
      const pointerKeys = keys.filter((key) => key.startsWith(POINTER));
      const values = await transport.getItems(pointerKeys);
      const pointers: VersionMeta[] = [],
        invalid: string[] = [];
      for (const key of pointerKeys) {
        const meta = values[key] === undefined ? null : parsePointer(values[key]);
        if (meta) pointers.push(meta);
        else invalid.push(key);
      }
      const present = new Set(keys);
      const incomplete = pointers
        .filter(
          (meta) =>
            !Array.from({ length: meta.parts }, (_, index) => partKey(meta.id, index)).every((key) => present.has(key)),
        )
        .map((meta) => meta.id);
      return { pointers, invalid, keys: keys.length, names: keys, incomplete };
    },
    async readVersion(meta) {
      return (await this.readVersionText!(meta)).snapshot;
    },
    async readVersionText(meta) {
      ensure();
      if (!(SUPPORTED_SNAPSHOT_FORMATS as readonly number[]).includes(meta.format))
        throw new SyncError(
          "format",
          meta.format > SNAPSHOT_FORMAT
            ? "В облаке версия более нового формата. Перезапустите приложение."
            : "В облаке версия устаревшего формата.",
        );
      const keys = Array.from({ length: meta.parts }, (_, index) => partKey(meta.id, index));
      const values = await transport.getItems(keys);
      const missing = keys.filter((key) => values[key] === undefined);
      if (missing.length)
        throw new SyncError("integrity", `Версия ${meta.id} неполная: нет ${missing.length} из ${meta.parts} частей.`);
      const text = keys.map((key) => values[key]).join("");
      if (checksum(text) !== meta.checksum)
        throw new SyncError("integrity", `Контрольная сумма версии ${meta.id} не совпадает.`);
      const packed = meta.format === PACKED_FORMAT;
      let json = text;
      if (packed) {
        const { unpackSnapshot } = await compression();
        try {
          json = unpackSnapshot(text);
        } catch {
          throw new SyncError("integrity", `Версия ${meta.id} не распаковывается.`);
        }
        if (meta.content === undefined || checksum(json) !== meta.content)
          throw new SyncError("integrity", `Содержимое версии ${meta.id} не совпадает с указателем.`);
      }
      try {
        return { snapshot: decodeSnapshot(json, packed ? meta.format : undefined), text };
      } catch (error) {
        if (error instanceof SnapshotFormatError)
          throw new SyncError("format", "Содержимое версии не соответствует формату.");
        throw new SyncError("integrity", `Версия ${meta.id} повреждена.`);
      }
    },
    async publishVersion(meta, snapshot, options = {}) {
      ensure();
      if (!WRITABLE_FORMATS.includes(meta.format))
        throw new SyncError("format", `Запись версии формата ${meta.format} не поддерживается.`);
      const json = encodeSnapshot(snapshot, meta.format);
      const packed = meta.format === PACKED_FORMAT;
      const codec = packed ? await compression() : null;
      const text = codec ? codec.packSnapshot(json) : json;
      if (codec && !unpacksTo(codec.unpackSnapshot, text, json))
        throw new SyncError("integrity", "Упакованный снимок не совпал с исходным: публикация отменена.");
      const parts = splitParts(text, partSize);
      const full: VersionMeta = {
        ...meta,
        parts: parts.length,
        checksum: checksum(text),
        ...(packed ? { content: checksum(json) } : {}),
      };
      const pointer = JSON.stringify(full);
      if (pointer.length > limits.maxValueLength)
        throw new SyncError("limit", "Указатель версии не помещается в одно значение.");
      const pointerName = pointerKey(meta.device);
      if (!validKey(pointerName, limits)) throw new SyncError("transport", "Недопустимый идентификатор устройства.");
      const { free, needed } = await this.room(parts.length, meta.device, options.keys);
      if (needed > free) throw new SyncError("limit", `В облаке нет места: нужно ${needed} ключей, свободно ${free}.`);
      await options.beforeWrite?.(full, text);
      // Части публикуются до указателя: неполная запись никогда не выглядит доступной версией.
      for (let index = 0; index < parts.length; index++) await transport.setItem(partKey(meta.id, index), parts[index]);
      await transport.setItem(pointerName, pointer);
      return { meta: full, chars: text.length };
    },
    async declareReads(device, id, reads) {
      ensure();
      const name = pointerKey(device);
      const raw = (await transport.getItems([name]))[name];
      const meta = raw === undefined ? null : parsePointer(raw);
      if (!meta || meta.id !== id) return false;
      const complete = async () => {
        const keys = new Set(await transport.getKeys());
        return Array.from({ length: meta.parts }, (_, index) => partKey(id, index)).every((key) => keys.has(key));
      };
      if (!(await complete())) return false;
      await transport.setItem(name, JSON.stringify({ ...JSON.parse(raw!), reads }));
      // Чужая уборка могла удалить указатель и части между проверкой и записью: указатель без частей не оставляем,
      // и следующий обмен опубликует версию заново, как после любой потери своего указателя.
      if (await complete()) return true;
      await transport.removeItems([name]);
      return false;
    },
    async listGenerations() {
      ensure();
      return [
        ...new Set(
          (await transport.getKeys())
            .map(parsePartKey)
            .filter((part): part is NonNullable<typeof part> => !!part)
            .map((part) => part.versionId),
        ),
      ];
    },
    async removeGenerations(versionIds) {
      ensure();
      if (!versionIds.length) return;
      const wanted = new Set(versionIds);
      const keys = (await transport.getKeys()).filter((key) => {
        const part = parsePartKey(key);
        return !!part && wanted.has(part.versionId);
      });
      if (keys.length) await transport.removeItems(keys);
    },
    async removeDevice(meta) {
      ensure();
      const name = pointerKey(meta.device);
      const counter = meta.clock[meta.device] ?? 0;
      const parts = (await transport.getKeys()).filter((key) => {
        const version = parseVersionId(parsePartKey(key)?.versionId ?? "");
        return !!version && version.device === meta.device && version.counter <= counter;
      });
      // Сравнения с удалением нет: указатель читается последним перед удалением, чтобы окно гонки было минимальным.
      const current = (await transport.getItems([name]))[name];
      if (current === undefined || parsePointer(current)?.id !== meta.id) return false;
      // Указатель первым: без него части не выглядят версией, даже если удаление частей оборвётся.
      await transport.removeItems([name]);
      if (parts.length) await transport.removeItems(parts);
      return true;
    },
    async listCoursePauses() {
      ensure();
      const keys = (await transport.getKeys()).filter((key) => key.startsWith(PAUSES));
      const values = await transport.getItems(keys);
      return Object.fromEntries(
        keys.flatMap((key) => (values[key] === undefined ? [] : [[key.slice(PAUSES.length), values[key]]])),
      );
    },
    async writeCoursePauses(device, value) {
      ensure();
      const name = pausesKey(device);
      if (!validKey(name, limits)) throw new SyncError("transport", "Недопустимый идентификатор устройства.");
      if (value.length > limits.maxValueLength)
        throw new SyncError("limit", "Паузы курсов не помещаются в одно значение.");
      const keys = await transport.getKeys();
      if (!keys.includes(name) && keys.length >= limits.maxKeys)
        throw new SyncError("limit", "В облаке нет места для пауз курсов.");
      await transport.setItem(name, value);
    },
    async removeCoursePauses(device, expected) {
      ensure();
      const name = pausesKey(device);
      if ((await transport.getItems([name]))[name] !== expected) return false;
      await transport.removeItems([name]);
      return true;
    },
    async room(partsNeeded, ownDevice, known) {
      ensure();
      const keys = known ?? (await transport.getKeys());
      const hasPointer = keys.includes(pointerKey(ownDevice));
      const needed = partsNeeded + (hasPointer ? 0 : 1);
      return { free: limits.maxKeys - keys.length, needed, keys: keys.length };
    },
  };
}

/**
 * Все ключи CloudStorage бота — область только этого Mini App. Указатели первыми: при обрыве между пакетами
 * не остаётся указателя на удалённые части.
 */
export async function removeAllKeys(transport: KeyValueTransport): Promise<void> {
  const keys = await transport.getKeys();
  const rank = (key: string) => (key.startsWith("p_") ? 0 : key.startsWith("cp_") ? 1 : key.startsWith("v_") ? 2 : 3);
  for (const group of [0, 1, 2, 3]) {
    const batch = keys.filter((key) => rank(key) === group);
    if (batch.length) await transport.removeItems(batch);
  }
}
