import type { Example } from "./types";

/**
 * Правка примера в редакторе. Разметка слов привязана к позициям в греческом предложении, поэтому
 * смена его текста снимает её: сдвинутые отрезки показали бы перевод не того слова. Правка перевода её не трогает.
 */
export function editExample(example: Example, next: Partial<Example>): Example {
  const edited = { ...example, ...next };
  if (next.greek !== undefined && next.greek !== example.greek) delete edited.glosses;
  return edited;
}
