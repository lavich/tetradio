import type { ExerciseFormat } from "../content/course";
import { shuffle } from "./options";
import type { MistakeItem, SessionItem } from "./types";

/**
 * Инструкция блока у пропуска и соединения описывает весь блок («Два слова лишние»); в карточке на четыре
 * варианта она неверна, поэтому вместо неё — общая инструкция формата.
 */
const FORMAT_INSTRUCTION: Partial<Record<ExerciseFormat, string>> = {
  gap: "Выберите слово для пропуска",
  match: "Выберите соответствие",
};
export const instructionOf = (item: MistakeItem) => FORMAT_INSTRUCTION[item.format] ?? item.instruction;

/** Ответ и до трёх других значений банка; одинаковый ответ у разных пунктов отсеивается по значению. */
const bankOptions = (item: MistakeItem, random: () => number) => {
  const answer = item.answer[0];
  const others = shuffle(
    [...new Set(item.options ?? [])].filter((value) => value !== answer),
    random,
  ).slice(0, 3);
  return shuffle([answer, ...others], random);
};
/** Пункт урока повторяется в своём формате: ввод остаётся вводом, выбор — выбором. */
export function itemExercise(item: MistakeItem, random: () => number): Pick<SessionItem, "type" | "options"> {
  if (item.format === "text") return { type: "item", options: [] };
  // Два варианта (Σωστό / Λάθος) урок не перемешивает: порядок там часть задания.
  if (item.format === "choice") {
    const options = item.options ?? [];
    return { type: "item", options: options.length > 2 ? shuffle(options, random) : options };
  }
  return { type: "item", options: bankOptions(item, random) };
}
