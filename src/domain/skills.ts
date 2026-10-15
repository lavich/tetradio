import type { ExerciseType, ReviewEvent } from "./types";

/**
 * Компактное состояние навыков карточки: всё, что нужно выбору упражнения, без полной истории ответов.
 * `recent` — исходы последних десяти ответов данного типа (старые → новые), `lastAt` — время последнего,
 * `lastTypes` — типы двух последних ответов, `cleanAssemblies` — чистые сборки после последней ошибки в написании.
 * Сводка описывает типы проверки, а не семантические навыки: совпадение имени с упражнением не делает её моделью знания.
 */
export interface TypeSkill {
  recent: boolean[];
  lastAt: string;
}
/** Тип проверки, которого эта версия не знает: код из снимка более новой версии, хранится и публикуется как есть. */
export type ForeignType = `~${string}`;
export type StoredType = ExerciseType | ForeignType;
export interface SkillSummary {
  types: Partial<Record<StoredType, TypeSkill>>;
  lastTypes: StoredType[];
  cleanAssemblies: number;
}
export const RECENT = 10;
export const emptySkills = (): SkillSummary => ({ types: {}, lastTypes: [], cleanAssemblies: 0 });
export const succeeded = (event: Pick<ReviewEvent, "correct" | "rating">) =>
  event.correct === null ? event.rating > 1 : event.correct;

/** Дополнительная попытка после ошибки: её id выводится из id проваленного задания. */
export const retryItemId = (itemId: string) => `${itemId}-retry`;
const isRetry = (itemId: string) => itemId.endsWith("-retry");

/** Один ответ меняет сводку так же, как его добавление в историю: это проверяется эквивалентностью с событиями. */
export function foldSkill(
  summary: SkillSummary,
  event: Pick<ReviewEvent, "type" | "correct" | "rating" | "createdAt" | "itemId">,
): SkillSummary {
  // Попытка идёт ступенью проще вскоре после показанного ответа: её успех не говорит о навыке.
  if (isRetry(event.itemId)) return summary;
  const previous = summary.types[event.type];
  const recent = [...(previous?.recent ?? []), succeeded(event)].slice(-RECENT);
  const cleanAssemblies =
    event.type === "spelling" && event.correct === false
      ? 0
      : event.type === "assembly" && event.correct === true
        ? summary.cleanAssemblies + 1
        : summary.cleanAssemblies;
  return {
    types: { ...summary.types, [event.type]: { recent, lastAt: event.createdAt } },
    lastTypes: [...summary.lastTypes, event.type].slice(-2),
    cleanAssemblies,
  };
}
export const byTime = <T extends { createdAt: string }>(events: T[]) =>
  [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
/** Сводка из полной истории карточки; события других карточек отбрасываются. */
export function summarizeEvents(
  unitKey: string,
  events: ReviewEvent[],
  base: SkillSummary = emptySkills(),
): SkillSummary {
  return byTime(events.filter((event) => event.unitKey === unitKey)).reduce(foldSkill, base);
}

/** Сводные показатели статистики: дни, последние исходы по типам и итоги — тоже без полной истории. `keys` — ключи карточек. */
export interface DaySummary {
  date: string;
  answers: number;
  keys: string[];
}
export interface StatsSummary {
  days: DaySummary[];
  recentByType: Partial<Record<StoredType, boolean[]>>;
  answers: number;
  answeredKeys: string[];
}
export const emptyStats = (): StatsSummary => ({ days: [], recentByType: {}, answers: 0, answeredKeys: [] });
/** Ответы — по порядку времени: от него зависят последние исходы по типам. */
export function foldStats(
  summary: StatsSummary,
  events: Pick<ReviewEvent, "type" | "correct" | "rating" | "unitKey" | "localDate">[],
  keepDays = 14,
): StatsSummary {
  const days = new Map(summary.days.map((day) => [day.date, { answers: day.answers, keys: new Set(day.keys) }]));
  const answeredKeys = new Set(summary.answeredKeys);
  const recentByType: Partial<Record<StoredType, boolean[]>> = { ...summary.recentByType };
  for (const event of events) {
    const day = days.get(event.localDate);
    if (day) {
      day.answers++;
      day.keys.add(event.unitKey);
    } else days.set(event.localDate, { answers: 1, keys: new Set([event.unitKey]) });
    answeredKeys.add(event.unitKey);
    recentByType[event.type] = [...(recentByType[event.type] ?? []), succeeded(event)].slice(-RECENT);
  }
  return {
    days: [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-keepDays)
      .map(([date, day]) => ({ date, answers: day.answers, keys: [...day.keys] })),
    recentByType,
    answers: summary.answers + events.length,
    answeredKeys: [...answeredKeys],
  };
}
