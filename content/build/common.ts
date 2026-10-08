import { createHash } from "node:crypto";
import { ContentError } from "../../src/content/schema.ts";
import { isLanguage, type Language } from "../../src/domain/language.ts";

/** Язык курса и урока без поля `language`. */
export const LANGUAGE: Language = "el";

export const hash = (value: string | Uint8Array, length = 12) =>
  createHash("sha256").update(value).digest("hex").slice(0, length);
/** Ключи в фиксированном порядке: одинаковое содержимое даёт одинаковую ревизию. */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export const pick = <T extends object>(value: T, fields: readonly (keyof T)[]) =>
  Object.fromEntries(fields.map((field) => [field, value[field]]));

export const fail: (message: string) => never = (message) => {
  throw new ContentError(message);
};
export const languageOf = (value: unknown, where: string): Language => {
  if (value === undefined || value === null) return LANGUAGE;
  if (!isLanguage(value)) fail(`${where}: нет профиля языка «${String(value)}»`);
  return value as Language;
};
export const text = (value: unknown, where: string, required = true): string | undefined => {
  if (value === undefined || value === null) {
    if (required) fail(`${where}: поле обязательно`);
    return undefined;
  }
  if (typeof value !== "string") fail(`${where}: ожидалась строка`);
  return (value as string).normalize("NFC");
};
/** Все строки объекта приводятся к NFC, чтобы ревизия и сравнение не зависели от формы записи в редакторе. */
export const nfc = (value: unknown): unknown =>
  typeof value === "string"
    ? value.normalize("NFC")
    : Array.isArray(value)
      ? value.map(nfc)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, nfc(v)]))
        : value;
