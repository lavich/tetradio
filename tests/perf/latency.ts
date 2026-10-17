export interface InteractionEntry {
  id: number;
  duration: number;
}

/** Нажатие без записи Event Timing быстрее порога наблюдателя (16 мс): считается как 8 мс. */
export const UNOBSERVED_MS = 8;

/** Запись Event Timing на каждое событие нажатия (`pointerdown`, `pointerup`, `click`): нажатию достаётся самое долгое. */
export function latencies(entries: InteractionEntry[], interactionCount: number) {
  const byId = new Map<number, number>();
  for (const { id, duration } of entries) byId.set(id, Math.max(duration, byId.get(id) ?? 0));
  const observed = [...byId.values()];
  return [...observed, ...Array.from({ length: Math.max(0, interactionCount - observed.length) }, () => UNOBSERVED_MS)];
}

export function percentile(values: number[], share: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)]!;
}
