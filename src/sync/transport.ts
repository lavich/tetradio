import type { TelegramCloudStorage } from "../platform/telegram-types";

/**
 * Транспорт «ключ → строка». Telegram CloudStorage — единственная реальная реализация первого этапа;
 * транспорт в памяти нужен контрактным тестам, отключённый — обычному браузеру, где облака нет.
 * Ограничения CloudStorage: 1024 ключа на пользователя бота, 4096 символов на значение, ключи из [A-Za-z0-9_-].
 */
export interface TransportLimits {
  maxKeys: number;
  maxValueLength: number;
  maxKeyLength: number;
}
export const CLOUD_LIMITS: TransportLimits = { maxKeys: 1024, maxValueLength: 4096, maxKeyLength: 128 };
export type SyncErrorKind = "disabled" | "unavailable" | "transport" | "limit" | "format" | "integrity" | "busy";
export class SyncError extends Error {
  constructor(
    public kind: SyncErrorKind,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
export interface KeyValueTransport {
  readonly limits: TransportLimits;
  available(): boolean;
  getKeys(): Promise<string[]>;
  getItems(keys: string[]): Promise<Record<string, string>>;
  setItem(key: string, value: string): Promise<void>;
  removeItems(keys: string[]): Promise<void>;
}
export const validKey = (key: string, limits: TransportLimits) =>
  key.length > 0 && key.length <= limits.maxKeyLength && /^[A-Za-z0-9_-]+$/.test(key);

/** Обычный браузер: синхронизация отключена явно, а не записывается в фиктивное облако. */
export function disabledTransport(): KeyValueTransport {
  const refuse = () =>
    Promise.reject(new SyncError("disabled", "Облачная синхронизация доступна только внутри Telegram."));
  return {
    limits: CLOUD_LIMITS,
    available: () => false,
    getKeys: refuse,
    getItems: refuse,
    setItem: refuse,
    removeItems: refuse,
  };
}

export interface MemoryTransportOptions {
  limits?: Partial<TransportLimits>;
  /** Перехват операций для инъекции сбоев: бросить ошибку — значит оборвать запрос. */ intercept?: (
    op: "getKeys" | "getItems" | "setItem" | "removeItems",
    key?: string,
  ) => void | Promise<void>;
}
export interface MemoryTransport extends KeyValueTransport {
  store: Map<string, string>;
  log: string[];
}
/** Транспорт в памяти с теми же лимитами и проверками, что у CloudStorage. */
export function memoryTransport(options: MemoryTransportOptions = {}): MemoryTransport {
  const limits = { ...CLOUD_LIMITS, ...options.limits };
  const store = new Map<string, string>(),
    log: string[] = [];
  const check = async (op: Parameters<NonNullable<MemoryTransportOptions["intercept"]>>[0], key?: string) => {
    log.push(key ? `${op} ${key}` : op);
    await options.intercept?.(op, key);
  };
  return {
    limits,
    store,
    log,
    available: () => true,
    async getKeys() {
      await check("getKeys");
      return [...store.keys()];
    },
    async getItems(keys) {
      await check("getItems");
      return Object.fromEntries(keys.filter((key) => store.has(key)).map((key) => [key, store.get(key)!]));
    },
    async setItem(key, value) {
      await check("setItem", key);
      if (!validKey(key, limits)) throw new SyncError("transport", `Недопустимый ключ ${key}`);
      if (value.length > limits.maxValueLength) throw new SyncError("transport", "Значение длиннее допустимого");
      if (!store.has(key) && store.size >= limits.maxKeys)
        throw new SyncError("limit", "В облаке нет места для нового ключа");
      store.set(key, value);
    },
    async removeItems(keys) {
      await check("removeItems");
      keys.forEach((key) => store.delete(key));
    },
  };
}

const wrap = <T>(run: (done: (error: string | null, value?: T) => void) => void, fallback: T): Promise<T> =>
  new Promise((resolve, reject) => {
    try {
      run((error, value) => (error ? reject(new SyncError("transport", error)) : resolve(value ?? fallback)));
    } catch (error) {
      reject(new SyncError("unavailable", "Telegram CloudStorage недоступен", error));
    }
  });
/** Официальный CloudStorage через callback API; порционные запросы укладываются в лимит одного вызова. */
export function cloudStorageTransport(storage: TelegramCloudStorage): KeyValueTransport {
  return {
    limits: CLOUD_LIMITS,
    available: () => typeof storage?.getItems === "function",
    getKeys: () => wrap<string[]>((done) => storage.getKeys(done), []),
    async getItems(keys) {
      const result: Record<string, string> = {};
      for (let index = 0; index < keys.length; index += 64) {
        // до 128 ключей за вызов; берём с запасом
        Object.assign(
          result,
          await wrap<Record<string, string>>((done) => storage.getItems(keys.slice(index, index + 64), done), {}),
        );
      }
      return result;
    },
    setItem: (key, value) => wrap<boolean>((done) => storage.setItem(key, value, done), true).then(() => undefined),
    async removeItems(keys) {
      for (let index = 0; index < keys.length; index += 64)
        await wrap<boolean>((done) => storage.removeItems(keys.slice(index, index + 64), done), true);
    },
  };
}
