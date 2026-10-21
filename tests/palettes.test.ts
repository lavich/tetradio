import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE, PALETTES, type PaletteName } from "../src/content/palettes";
import { coverColor, mutedCover } from "../src/shared/notebook";

const channels = (color: string) =>
  color.startsWith("#")
    ? [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16))
    : color.match(/\d+/g)!.slice(0, 3).map(Number);
const luminance = (color: string) => {
  const [r, g, b] = channels(color).map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const whiteContrast = (color: string) => 1.05 / (luminance(color) + 0.05);

describe("гаммы обложек", () => {
  const names = Object.keys(PALETTES) as PaletteName[];

  it("у каждой гаммы шесть разных цветов", () => {
    expect(names).toEqual(expect.arrayContaining(["school", "ink", "coast"]));
    for (const name of names) {
      expect(PALETTES[name]).toHaveLength(6);
      expect(new Set(PALETTES[name]).size).toBe(6);
    }
  });
  it("белый текст на каждом цвете и на приглушённой обложке читается: контраст не ниже 4.5:1", () => {
    for (const name of names)
      for (let number = 1; number <= 6; number++) {
        expect(whiteContrast(coverColor(number, name)), `${name} ${number}`).toBeGreaterThanOrEqual(4.5);
        expect(whiteContrast(mutedCover(number, name)), `${name} ${number} на паузе`).toBeGreaterThanOrEqual(4.5);
      }
  });
  it("гамма по умолчанию — прежние цвета обложек греческого курса", () => {
    expect(DEFAULT_PALETTE).toBe("school");
    expect(PALETTES.school).toEqual(["#2f6d4f", "#b8452b", "#2c4f9e", "#936c15", "#7b3f74", "#1f6f7a"]);
    expect([1, 2, 7, 12].map((number) => coverColor(number))).toEqual(["#2f6d4f", "#b8452b", "#2f6d4f", "#1f6f7a"]);
    expect(mutedCover(1)).toBe(mutedCover(1, "school"));
  });
  it("цвет обложки зависит только от гаммы и номера модуля", () => {
    expect(coverColor(3, "ink")).toBe(PALETTES.ink[2]);
    expect(coverColor(9, "coast")).toBe(PALETTES.coast[2]);
    expect(coverColor(1, "ink")).not.toBe(coverColor(1, "coast"));
  });
});
