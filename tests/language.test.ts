import { describe, expect, it } from "vitest";
import { checkItem, spokenChoice } from "../src/domain/course";
import type { ExerciseBlock, ExerciseItem } from "../src/content/course";
import { PROFILES, profileOf } from "../src/domain/language";
import { isCheckable } from "../src/domain/plan";
import { checkAnswer, checkTextAnswer } from "../src/domain/text-answer";
import { assemblyExercise, wordExerciseOptions, NO_SYLLABLES } from "../src/domain/word-exercise";
import type { Word } from "../src/domain/types";

const en = PROFILES.en;

describe("профиль английского языка", () => {
  it("апостроф и сокращения — верно", () => {
    expect(checkTextAnswer("I don’t know", ["I don't know"], en).status).toBe("correct");
    expect(checkTextAnswer("I do not know", ["I don't know"], en).status).toBe("correct");
    expect(checkTextAnswer("I can not swim", ["I can't swim"], en).status).toBe("correct");
    expect(checkTextAnswer("We're late.", ["We are late"], en).status).toBe("correct");
  });

  it("одна буква в слове от пяти букв — почти, в коротком слове — неверно", () => {
    const typo = checkTextAnswer("I live in Lodon", ["I live in London"], en);
    expect(typo).toMatchObject({ status: "almost", message: "Почти! Проверь написание." });
    expect(checkTextAnswer("I lave in London", ["I live in London"], en).status).toBe("wrong");
    expect(checkTextAnswer("I live in Lndn", ["I live in London"], en).status).toBe("wrong");
  });

  it("знак в конце необязателен, «;» не считается концом фразы", () => {
    expect(checkTextAnswer("How are you", ["How are you?"], en).status).toBe("correct");
    expect(checkTextAnswer("How are you;", ["How are you?"], en).status).toBe("wrong");
  });

  it("артикль в ответе-слове — почти", () => {
    expect(checkAnswer("apple", "an apple", en)).toEqual({ status: "almost", message: "Почти! Проверь артикль." });
    expect(checkAnswer("the apple", "an apple", en).status).toBe("almost");
  });

  it("задание урока сравнивается по языку курса", () => {
    const block = { format: "text" } as ExerciseBlock;
    const item = { answer: ["She doesn't work."] } as ExerciseItem;
    expect(checkItem(block, item, "she does not work", en).status).toBe("correct");
  });

  it("вариант выбора произносится, если он на языке курса", () => {
    expect(spokenChoice("She ___ to work.", "goes", en)).toBe("She goes to work.");
    expect(spokenChoice("She ___ to work.", "идёт", en)).toBeNull();
  });

  it("сборки из слогов нет", () => {
    const word: Word = { id: "w1", greek: "beautiful", russian: "красивый" } as Word;
    expect(assemblyExercise(word, Math.random, en)).toBeNull();
    expect(wordExerciseOptions(word, { close: [], pool: [] }, true, en).assembly).toEqual({
      available: false,
      reason: NO_SYLLABLES,
    });
  });

  it("фраза без перевода и записи доступна, только если есть голос её языка", () => {
    const onlyEnglish = (language: string) => language === "en";
    const silent = { kind: "phrase" as const, hasTranslation: false, hasAudio: false };
    expect(isCheckable({ ...silent, language: "el" }, { hasVoice: onlyEnglish, phrasePool: 4 })).toBe(false);
    expect(isCheckable({ ...silent, language: "en" }, { hasVoice: onlyEnglish, phrasePool: 4 })).toBe(true);
  });

  it("язык по коду", () => {
    expect(profileOf(undefined).code).toBe("el");
    expect(() => profileOf("fr")).toThrow("Нет профиля языка «fr»");
  });
});
