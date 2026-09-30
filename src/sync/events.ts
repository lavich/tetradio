/**
 * Лёгкая шина событий между хранилищем и координатором синхронизации: операции сообщают об изменениях,
 * не импортируя ни Telegram, ни координатор. Доменные модули остаются независимыми от транспорта.
 */
export type SyncEvent = "changed" | "restored";
type Listener = (event: SyncEvent) => void;
const listeners = new Set<Listener>();
export const syncEvents = {
  emit(event: SyncEvent) {
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error(error);
      }
    });
  },
  on(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
