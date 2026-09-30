import { describe, it, expect } from "vitest";
import { parseImport, normalize, checkAnswer } from "../src/domain/import";
describe("Quizlet import", () => {
  it("keeps real pairs and source mastery, removes UI lines", () => {
    const result = parseImport(
      "το φως\nсвет\n\nMastered (1)\nYou know these terms very well!\nSelect these 1\nτο νερό\nвода",
    );
    expect(result.rows.map((r) => [r.greek, r.russian, r.sourceMastered])).toEqual([
      ["το φως", "свет", false],
      ["το νερό", "вода", true],
    ]);
    expect(result.errors).toEqual([]);
  });
  it("reports unmatched lines and does not silently shift pairs", () =>
    expect(parseImport("το φως\nсвет\nτο σπίτι").errors[0].line).toBe(3));
  it("reads TSV with IPA and flags invalid Greek", () => {
    expect(parseImport("το φως\tсвет\t/to fos/").rows[0].ipa).toBe("/to fos/");
    expect(parseImport("hello\nпривет").errors).toHaveLength(1);
  });
  it("deduplicates normalization consistently", () => expect(normalize("  ΤΟ  ΣΠΊΤΙ ")).toBe("το σπίτι"));
});
describe("Greek answers", () => {
  it.each([
    [" ΤΟ ΣΠΊΤΙ ", "correct"],
    ["το σπιτι", "almost"],
    ["σπίτι", "almost"],
    ["το σπίτι".normalize("NFD"), "correct"],
    ["ο σπίτι", "almost"],
    ["το σκύλος", "wrong"],
  ])("%s -> %s", (answer, result) => expect(checkAnswer(answer, "το σπίτι").status).toBe(result));
});
