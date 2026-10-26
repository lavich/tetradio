export type ErasePhase = "cloud" | "local";

const key = (database: string) => `tetradio:erasing:${database}`;

export function erasePhase(database: string): ErasePhase | null {
  try {
    const value = localStorage.getItem(key(database));
    return value === "cloud" || value === "local" ? value : null;
  } catch {
    return null;
  }
}
export const markErase = (database: string, phase: ErasePhase) => localStorage.setItem(key(database), phase);
export const clearErase = (database: string) => localStorage.removeItem(key(database));
