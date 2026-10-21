import { DEFAULT_PALETTE, PALETTES, type PaletteName } from "../content/palettes.ts";
import { PROFILES, type LanguageProfile } from "../domain/language.ts";

/** «Πέμπτη, 1 Οκτωβρίου» или «Thursday, 1 October»: день плана занятия, а не момент открытия экрана. */
export function pageDate(day: string, profile: LanguageProfile = PROFILES.el) {
  const { locale, upper } = profile.date;
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).formatToParts(new Date(`${day}T12:00:00Z`));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday");
  const head = upper ? weekday.charAt(0).toLocaleUpperCase(profile.code) + weekday.slice(1) : weekday;
  return `${head}, ${get("day")} ${get("month")}`;
}

/** Цвет обложки по номеру модуля; греческие школьные тетради яркие — это гамма по умолчанию. */
export const coverColor = (number: number, palette: PaletteName = DEFAULT_PALETTE) =>
  PALETTES[palette][(number - 1) % PALETTES[palette].length];
/**
 * Приглушённый цвет обложки курса на паузе: матрица CSS `grayscale(0.85)`, применённая только к фону, — яркость почти
 * та же, белые подписи читаются, а рамка фокуса и метка текущего модуля не теряют цвет, как под фильтром всей обложки.
 */
export function mutedCover(number: number, palette: PaletteName = DEFAULT_PALETTE): string {
  const hex = coverColor(number, palette);
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const k = 0.15;
  const channel = (wr: number, wg: number, wb: number) => Math.round(wr * r + wg * g + wb * b);
  return `rgb(${channel(0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k)}, ${channel(
    0.2126 - 0.2126 * k,
    0.7152 + 0.2848 * k,
    0.0722 - 0.0722 * k,
  )}, ${channel(0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k)})`;
}
