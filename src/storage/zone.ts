import Dexie from "dexie";

// Нативный промис вложенной async-функции выводит живой запрос из зоны Dexie: чтения после `await` он не отслеживает.
export const zoned =
  <A extends unknown[], R>(read: (...args: A) => Promise<R>) =>
  (...args: A): Promise<R> =>
    Dexie.Promise.resolve(read(...args));
