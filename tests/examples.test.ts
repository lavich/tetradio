import { describe, expect, it } from "vitest";
import { editExample } from "../src/domain/examples";
import type { Example } from "../src/domain/types";

const example: Example = {
  greek: "Το σπίτι μας είναι μεγάλο.",
  russian: "Наш дом большой.",
  target: "σπίτι",
  glosses: [{ start: 3, length: 5, russian: "дом", wordId: "w12-16" }],
};

describe("правка размеченного примера", () => {
  it("смена греческого текста снимает разметку", () => {
    const edited = editExample(example, { greek: "Το σπίτι σας είναι μεγάλο." });
    expect(edited.greek).toBe("Το σπίτι σας είναι μεγάλο.");
    expect(edited).not.toHaveProperty("glosses");
  });
  it("правка только перевода или слова-цели разметку сохраняет", () => {
    expect(editExample(example, { russian: "Наш дом велик." }).glosses).toEqual(example.glosses);
    expect(editExample(example, { target: "σπίτι μας" }).glosses).toEqual(example.glosses);
    expect(editExample(example, { greek: example.greek }).glosses).toEqual(example.glosses);
  });
  it("исходный пример не меняется", () => {
    editExample(example, { greek: "Άλλο." });
    expect(example.glosses).toHaveLength(1);
  });
});
