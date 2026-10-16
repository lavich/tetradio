import { plural } from "../../shared/format";
import type { ReadingView } from "../../storage/readings";

export interface ReadingGroup {
  module: ReadingView["module"];
  items: ReadingView[];
}

/** Группы по модулям в порядке программы; внутри — непрочитанные, затем прочитанные, каждая часть в порядке программы. */
export function groupByModule(open: ReadingView[]): ReadingGroup[] {
  const groups = new Map<string, ReadingGroup>();
  for (const view of open) {
    const group = groups.get(view.moduleId) ?? { module: view.module, items: [] };
    group.items.push(view);
    groups.set(view.moduleId, group);
  }
  return [...groups.values()].map(({ module, items }) => ({
    module,
    items: [...items.filter((item) => !item.readAt), ...items.filter((item) => item.readAt)],
  }));
}

const TEXTS: [string, string, string] = ["текст", "текста", "текстов"];

export function closedLine(count: number) {
  const one = plural(count, TEXTS) === TEXTS[0];
  return `Ещё ${count} ${plural(count, TEXTS)} ${one ? "откроется после урока" : "откроются после уроков"}.`;
}

export interface ReadingEntry {
  fromReadings?: boolean;
  fromModule?: boolean;
}

/** Из списка «Чтение» текст возвращает в список и ведёт дальше по всему курсу, иначе — в модуль и по тексту модуля. */
export function readingExits(
  state: ReadingEntry | null,
  moduleNext: ReadingView | undefined,
  listNext: ReadingView | undefined,
) {
  const toList = !!state?.fromReadings;
  const next = toList ? listNext : moduleNext?.open ? moduleNext : undefined;
  return { label: toList ? "К списку текстов" : "К модулю", toList, ...(next ? { next } : {}) };
}
