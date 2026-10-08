import { describe, expect, it } from "vitest";
import { PROFILES } from "../src/domain/language";
import { optionLetter } from "../src/features/learning/exercises/Choice";
import { noVoice } from "../src/shared/language";
import { pageDate } from "../src/shared/notebook";
import { voicesOf } from "../src/shared/voices";

describe("язык курса в интерфейсе", () => {
  it("дата страницы: греческая — с заглавной буквы, английская — в своём формате", () => {
    expect(pageDate("2026-10-01")).toBe("Πέμπτη, 1 Οκτωβρίου");
    expect(pageDate("2026-10-01", PROFILES.el)).toBe("Πέμπτη, 1 Οκτωβρίου");
    expect(pageDate("2026-10-01", PROFILES.en)).toBe("Thursday, 1 October");
  });

  it("голос выбирается по языку, голос региона профиля — первым", () => {
    const voices = [
      { lang: "ru-RU", name: "Русский" },
      { lang: "en-US", name: "American" },
      { lang: "el-GR", name: "Ελληνικά" },
      { lang: "en_GB", name: "British" },
    ];
    expect(voicesOf(voices, PROFILES.el).map((voice) => voice.name)).toEqual(["Ελληνικά"]);
    expect(voicesOf(voices, PROFILES.en).map((voice) => voice.name)).toEqual(["British", "American"]);
    expect(voicesOf([{ lang: "ru-RU" }], PROFILES.en)).toEqual([]);
  });

  it("буквы вариантов — из профиля: α β γ у греческого, a b c у английского", () => {
    expect([0, 1, 2].map((index) => optionLetter(index, PROFILES.el))).toEqual(["α", "β", "γ"]);
    expect([0, 1, 2].map((index) => optionLetter(index, PROFILES.en))).toEqual(["a", "b", "c"]);
    expect(optionLetter(6, PROFILES.en)).toBe("7");
  });

  it("сообщение об отсутствии голоса называет язык; греческое — прежнее", () => {
    expect(noVoice(PROFILES.el)).toBe("На устройстве нет греческого голоса — включите его в настройках речи.");
    expect(PROFILES.en.voiceName).toBe("английского голоса");
  });
});
