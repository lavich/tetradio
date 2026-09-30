import type { Clock } from "./types";
/** Причинный порядок версий: вектор счётчиков устройств. Время не участвует в выборе победителя. */
export const dominates = (a: Clock, b: Clock) =>
  Object.entries(b).every(([device, count]) => (a[device] ?? 0) >= count);
export const sameClock = (a: Clock, b: Clock) => dominates(a, b) && dominates(b, a);
export const concurrent = (a: Clock, b: Clock) => !dominates(a, b) && !dominates(b, a);
export const mergeClocks = (...clocks: Clock[]): Clock => {
  const merged: Clock = {};
  for (const clock of clocks)
    for (const [device, count] of Object.entries(clock)) merged[device] = Math.max(merged[device] ?? 0, count);
  return merged;
};
