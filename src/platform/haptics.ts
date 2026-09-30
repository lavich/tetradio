import { useSyncExternalStore } from "react";
import { db } from "../storage/db";

/**
 * Настройка тактильного отклика локальна устройству и Telegram-профилю: хранится в localStorage,
 * не входит в синхронизируемые учебные настройки и не попадает в копию. По умолчанию включена.
 */
const KEY = `lexi:haptics:${db.name}`;
const listeners = new Set<() => void>();
export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}
export function setHapticsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(KEY, enabled ? "1" : "0");
  } catch {
    /* без хранилища настройка живёт до перезагрузки */
  }
  listeners.forEach((listener) => listener());
}
export function useHapticsSetting(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hapticsEnabled,
    () => true,
  );
  return [enabled, setHapticsEnabled];
}
