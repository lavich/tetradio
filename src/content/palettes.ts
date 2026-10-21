export const PALETTES = {
  school: ["#2f6d4f", "#b8452b", "#2c4f9e", "#936c15", "#7b3f74", "#1f6f7a"],
  ink: ["#1f4e79", "#2b6a6e", "#46506a", "#3b4f9a", "#1d6559", "#5a4a86"],
  coast: ["#a3472f", "#8a6214", "#5f6b23", "#1b6b6f", "#94405a", "#7a5332"],
} as const satisfies Record<string, readonly string[]>;
export type PaletteName = keyof typeof PALETTES;
export const DEFAULT_PALETTE: PaletteName = "school";
export const isPalette = (value: unknown): value is PaletteName =>
  typeof value === "string" && Object.hasOwn(PALETTES, value);
