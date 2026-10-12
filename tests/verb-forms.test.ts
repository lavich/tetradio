import { describe, expect, it } from "vitest";
import { ENDINGS, principalParts, splitEnding } from "../src/domain/verb-forms";

describe("ряд основных форм", () => {
  it("греческий глагол", () => {
    expect(principalParts("ψάχνω", "аор. έψαξα; буд. θα ψάξω; повел. ψάξε")).toEqual([
      { form: "ψάχνω", label: "сейчас" },
      { form: "έψαξα", label: "было" },
      { form: "θα ψάξω", label: "будет" },
      { form: "ψάξε", label: "делай" },
    ]);
  });
  it("английский глагол", () => {
    expect(principalParts("drive", "прош. drove, прич. driven")?.map((part) => part.form)).toEqual([
      "drive",
      "drove",
      "driven",
    ]);
  });
  it("не глагол и пустая форма", () => {
    expect(principalParts("ο φίλος", "мн. οι φίλοι")).toBeNull();
    expect(principalParts("καλός", "καλός, καλή, καλό")).toBeNull();
    expect(principalParts("πρέπει", "аор. —; буд. θα πρέπει")).toEqual([
      { form: "πρέπει", label: "сейчас" },
      { form: "θα πρέπει", label: "будет" },
    ]);
  });
});

describe("окончание", () => {
  it.each([
    ["μένω", ENDINGS.present[0], "μέν", "ω"],
    ["έμεινα", ENDINGS.past[0], "έμειν", "α"],
    ["θα μείνω", ENDINGS.present[0], "θα μείν", "ω"],
    ["μείναμε", ENDINGS.past[3], "μείν", "αμε"],
    ["ερχόμαστε", ENDINGS.present[3], "ερχ", "όμαστε"],
    ["κοιμούνται", ENDINGS.present[5], "κοιμ", "ούνται"],
    ["μπορείτε", ENDINGS.present[4], "μπορ", "είτε"],
    ["είμαστε", ENDINGS.present[3], "είμαστε", ""],
    ["είστε", ENDINGS.present[4], "είστε", ""],
    ["ήμουν", ENDINGS.past[0], "ήμουν", ""],
    ["ψάξε", ENDINGS.imperative, "ψάξ", "ε"],
    ["ανέβα", ENDINGS.imperative, "ανέβ", "α"],
    ["ω", ENDINGS.present[0], "ω", ""],
  ])("%s", (form, endings, stem, ending) => {
    expect(splitEnding(form, "el", endings)).toEqual([stem, ending]);
  });
  it("у английского не выделяется", () => {
    expect(splitEnding("driven", "en", ENDINGS.past[0])).toEqual(["driven", ""]);
  });
});
