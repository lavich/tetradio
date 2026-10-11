import type { StoredType } from "./skills";
import type { ExerciseType } from "./types";

/** Коды типов проверки в облачном снимке; коды снятых `recall` и `cloze` заняты: их содержит старая история. */
export const TYPE_CODE: Record<ExerciseType, string> = {
  recall: "c",
  recognition: "r",
  assembly: "a",
  spelling: "s",
  listening: "l",
  comprehension: "m",
  cloze: "z",
  item: "i",
  wordGap: "g",
};
const CODE_TYPE = new Map(Object.entries(TYPE_CODE).map(([type, code]) => [code, type as ExerciseType]));
export const typeOfCode = (code: string): ExerciseType | undefined => CODE_TYPE.get(code);
/** Тип незнакомого кода хранится с этим префиксом: так он не совпадает ни с одним известным типом. */
export const FOREIGN_TYPE = "~";
/** Тип, который был незнакомым, после обновления становится известным. */
export const knownType = (type: StoredType): StoredType =>
  (type.startsWith(FOREIGN_TYPE) && typeOfCode(type.slice(FOREIGN_TYPE.length))) || type;
