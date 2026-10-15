import Dexie from "dexie";

// Нативный промис вложенной async-функции выводит из зоны Dexie живой запрос и транзакцию: чтения после `await` идут мимо них.
export const zoned =
  <A extends unknown[], R>(read: (...args: A) => Promise<R>) =>
  (...args: A): Promise<R> =>
    Dexie.Promise.resolve(read(...args));
