export class DatabaseBlocked extends Error {}
export class DatabaseNotDeleted extends Error {}

/** `blocked` значит, что базу держит другое окно: ждать его бессмысленно, удаление завершится при следующем запуске. */
export function deleteDatabase(name: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(name);
    } catch {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new DatabaseBlocked(name)), timeoutMs);
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(new DatabaseNotDeleted(name));
    };
  });
}
