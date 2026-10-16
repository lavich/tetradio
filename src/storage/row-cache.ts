import Dexie, { cmp, RangeSet, type IndexableType, type ObservabilitySet } from "dexie";
import type { AppDatabase } from "./db";
import { zoned } from "./zone";

interface Store<V> {
  database: AppDatabase;
  rows: Map<string, V | undefined>;
  reading: Map<string, Promise<V | undefined>>;
  generation: number;
  changed: Map<string, number>;
  cleared: number;
}
interface Registered {
  table: string;
  keyOf: (key: IndexableType) => string | undefined;
  stores: Map<string, Store<unknown>>;
}

const registered: Registered[] = [];
const PRIMARY_PART = /^idb:\/\/(.+)\/([^/]+)\/$/;

// Событие приходит и об изменениях из соседних вкладок.
Dexie.on("storagemutated", (parts: ObservabilitySet) => {
  for (const [part, ranges] of Object.entries(parts)) {
    if (!part.startsWith("idb://")) {
      for (const cache of registered) cache.stores.clear();
      return;
    }
    const [, name, table] = PRIMARY_PART.exec(part) ?? [];
    for (const cache of registered) {
      const store = table === cache.table ? cache.stores.get(name) : undefined;
      if (!store) continue;
      const generation = ++store.generation;
      for (const range of RangeSet(ranges)) {
        const key = cmp(range.from, range.to) === 0 ? cache.keyOf(range.from) : undefined;
        if (key === undefined) {
          store.rows.clear();
          store.reading.clear();
          store.cleared = generation;
          break;
        }
        store.rows.delete(key);
        store.reading.delete(key);
        store.changed.set(key, generation);
      }
    }
  }
});

/**
 * Строки таблицы в памяти, по ключу `keyOf(первичный ключ)`; запись сбрасывает только изменённые ключи. Кэш не
 * подписывает живой запрос: подписка — забота вызывающего.
 */
export function rowCache<V>(
  table: string,
  keyOf: (key: IndexableType) => string | undefined = (key) => (typeof key === "string" ? key : undefined),
) {
  const cache: Registered = { table, keyOf, stores: new Map() };
  registered.push(cache);
  const storeOf = (database: AppDatabase) => {
    const known = cache.stores.get(database.name) as Store<V> | undefined;
    if (known?.database === database) return known;
    const fresh: Store<V> = {
      database,
      rows: new Map(),
      reading: new Map(),
      generation: 0,
      changed: new Map(),
      cleared: 0,
    };
    cache.stores.set(database.name, fresh as Store<unknown>);
    return fresh;
  };
  /** Отсутствие строки тоже запоминается: `load` возвращает `undefined` для ключа, которого нет в базе. */
  return zoned(async function rows(
    keys: string[],
    database: AppDatabase,
    load: (keys: string[]) => Promise<(V | undefined)[]>,
  ): Promise<(V | undefined)[]> {
    // Сброс приходит после фиксации, а транзакция записи видит свои незафиксированные строки.
    if (Dexie.currentTransaction?.mode === "readwrite") return load(keys);
    const store = storeOf(database);
    const start = store.generation;
    const found = new Map<string, V | undefined>();
    const waiting = new Map<string, Promise<V | undefined>>();
    const missing: string[] = [];
    for (const key of new Set(keys)) {
      const reading = store.reading.get(key);
      if (store.rows.has(key)) found.set(key, store.rows.get(key));
      // Перезапуски живых запросов накладываются: строку, которую уже читает соседний, не читаем второй раз.
      else if (reading) waiting.set(key, reading);
      else missing.push(key);
    }
    if (missing.length) {
      const read = load(missing);
      const own = missing.map((key, index) => {
        const row = read.then((rows) => rows[index]);
        row.catch(() => undefined);
        store.reading.set(key, row);
        waiting.set(key, row);
        return row;
      });
      try {
        const rows = await read;
        missing.forEach((key, index) => {
          // Строка, изменённая во время чтения, могла прочитаться прежней: такую не запоминаем.
          if (Math.max(store.cleared, store.changed.get(key) ?? 0) <= start) store.rows.set(key, rows[index]);
        });
      } finally {
        missing.forEach((key, index) => {
          if (store.reading.get(key) === own[index]) store.reading.delete(key);
        });
      }
    }
    for (const [key, row] of waiting) found.set(key, await row);
    return keys.map((key) => found.get(key));
  });
}
