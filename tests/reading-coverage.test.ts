import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { coverage, share } from "../content/coverage";
import type { MatchCard } from "../content/marks";

/** Словарь пилота — карточки и глоссы уроков m01–m03 настоящего курса. */
const built = buildContent("content");
const lessons = built.packages.filter((pack) => /^m0[123]-/.test(pack.id));
const words = new Map(built.words.map((word) => [word.id, word]));
const phrases = new Map(built.phrases.map((phrase) => [phrase.id, phrase]));
const cards: MatchCard[] = lessons.flatMap((pack) =>
  pack.items.map((item) =>
    item.kind === "word"
      ? { ref: item.id, text: words.get(item.id)!.greek, forms: words.get(item.id)!.forms }
      : { ref: item.id, text: phrases.get(item.id)!.text, phrase: true },
  ),
);
const lessonGlosses = lessons.flatMap((pack) =>
  (pack.blocks ?? []).flatMap((block) => ("glosses" in block && block.glosses ? block.glosses.map((g) => g.text) : [])),
);
interface Pilot {
  id: string;
  text: string;
  names?: string[];
  glosses?: Record<string, string>;
  expected: { strict?: number; known?: number; glosses?: number; names?: number; passes?: boolean; unknown?: string[] };
}
const pilots = parse(readFileSync("openspec/changes/reading-shelf/pilot-texts.yaml", "utf8")) as Pilot[];
const measure = (pilot: Pilot) =>
  coverage({
    text: pilot.text,
    glosses: Object.entries(pilot.glosses ?? {}).map(([text, russian]) => ({ text, russian })),
    names: pilot.names ?? [],
    cards,
    lessonGlosses,
  });

describe("мягкий подсчёт знакомых слов на пилотных текстах", () => {
  for (const pilot of pilots.filter((entry) => entry.expected.known !== undefined))
    it(`${pilot.id}: доли совпадают с фикстурой, порог 95 % — ${pilot.expected.passes ? "проходит" : "нет"}`, () => {
      const result = measure(pilot);
      expect(share(result.strict, result.total)).toBe(pilot.expected.strict);
      expect(share(result.known, result.total)).toBe(pilot.expected.known);
      expect(share(result.glossed, result.total)).toBe(pilot.expected.glosses);
      expect(share(result.named, result.total)).toBe(pilot.expected.names);
      expect(share(result.known, result.total) >= 95).toBe(pilot.expected.passes);
    });
  it("ложная основа с приставкой не делает слово знакомым", () => {
    const pilot = pilots.find((entry) => entry.id === "false-friend")!;
    expect(measure(pilot).unknown).toEqual(pilot.expected.unknown);
  });
  it("глоссы не делают слова знакомыми", () => {
    const pilot = pilots.find((entry) => entry.id === "maria")!;
    const bare = coverage({ text: pilot.text, glosses: [], names: pilot.names ?? [], cards, lessonGlosses });
    expect(share(bare.known, bare.total)).toBe(pilot.expected.known);
  });
  it("слово будущего модуля без общей основы незнакомо", () => {
    expect(measure({ id: "x", text: "Το νοσοκομείο είναι εδώ.", expected: {} }).unknown).toContain("νοσοκομείο");
  });
});
