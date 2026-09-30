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
}
export interface SyncAdapter {
  capabilities(): SyncCapabilities;
  listPointers(): Promise<PointerListing>;
  readVersion(meta: VersionMeta): Promise<CompactSnapshot>;
  /** Идемпотентно: повтор той же версии перезаписывает те же части и указатель. */
  publishVersion(meta: Omit<VersionMeta, "parts" | "checksum">, snapshot: CompactSnapshot): Promise<VersionMeta>;
  /** Идентификаторы версий, части которых лежат в облаке (включая незавершённые публикации). */
  listGenerations(): Promise<string[]>;
  /** Удаляет части перечисленных версий; указатели других устройств не трогает. */
  removeGenerations(versionIds: string[]): Promise<void>;
  /** Сколько ключей займёт версия и сколько свободно с учётом собственного указателя. */
  room(partsNeeded: number, ownDevice: string): Promise<{ free: number; needed: number; keys: number }>;
}
export const PART_SIZE = 4000;
const POINTER = "p_",
  PART = "v_";
export const pointerKey = (device: string) => `${POINTER}${device}`;
export const partKey = (versionId: string, index: number) => `${PART}${versionId}_${index}`;
export const parsePartKey = (key: string): { versionId: string; index: number } | null => {
  const match = /^v_(.+)_(\d+)$/.exec(key);
  return match ? { versionId: match[1], index: Number(match[2]) } : null;
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
      resolves: Array.isArray(meta.resolves) ? meta.resolves.filter((item: unknown) => typeof item === "string") : [],
      label: typeof meta.label === "string" ? meta.label : undefined,
    };
  } catch {
    return null;
  }
}

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
      return { pointers, invalid, keys: keys.length };
    },
    async readVersion(meta) {
      ensure();
      if (!(SUPPORTED_SNAPSHOT_FORMATS as readonly number[]).includes(meta.format))
        throw new SyncError(
          "format",
          meta.format > SNAPSHOT_FORMAT
            ? "В облаке версия более нового формата. Обновите приложение."
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
      try {
        return decodeSnapshot(text);
      } catch (error) {
        if (error instanceof SnapshotFormatError)
          throw new SyncError("format", "Содержимое версии не соответствует формату.");
        throw new SyncError("integrity", `Версия ${meta.id} повреждена.`);
      }
    },
    async publishVersion(meta, snapshot) {
      ensure();
      const text = encodeSnapshot(snapshot);
      const parts = splitParts(text, partSize);
      const full: VersionMeta = { ...meta, parts: parts.length, checksum: checksum(text) };
      const pointer = JSON.stringify(full);
      if (pointer.length > limits.maxValueLength)
        throw new SyncError("limit", "Указатель версии не помещается в одно значение.");
      const pointerName = pointerKey(meta.device);
      if (!validKey(pointerName, limits)) throw new SyncError("transport", "Недопустимый идентификатор устройства.");
      const { free, needed } = await this.room(parts.length, meta.device);
      if (needed > free) throw new SyncError("limit", `В облаке нет места: нужно ${needed} ключей, свободно ${free}.`);
      // Части публикуются до указателя: неполная запись никогда не выглядит доступной версией.
      for (let index = 0; index < parts.length; index++) await transport.setItem(partKey(meta.id, index), parts[index]);
      await transport.setItem(pointerName, pointer);
      return full;
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
    async room(partsNeeded, ownDevice) {
      ensure();
      const keys = await transport.getKeys();
      const hasPointer = keys.includes(pointerKey(ownDevice));
      const needed = partsNeeded + (hasPointer ? 0 : 1);
      return { free: limits.maxKeys - keys.length, needed, keys: keys.length };
    },
  };
}
