import type { ExerciseFormat } from "../content/course";
import type { MistakeItem } from "./types";

/**
 * Инструкция блока у пропуска и соединения описывает весь блок («Два слова лишние»); в карточке на четыре
 * варианта она неверна, поэтому вместо неё — общая инструкция формата.
 */
const FORMAT_INSTRUCTION: Partial<Record<ExerciseFormat, string>> = {
  gap: "Выберите слово для пропуска",
  match: "Выберите соответствие",
};
export const instructionOf = (item: MistakeItem) => FORMAT_INSTRUCTION[item.format] ?? item.instruction;
