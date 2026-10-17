import { describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { coverer, coverage } from "../content/coverage";
import { buildMatcher, candidates, lessonMarks, type MatchCard } from "../content/marks";
import type { LessonBlock } from "../src/content/course";

const word = (ref: string, text: string, at: number, forms?: string): MatchCard => ({ ref, text, forms, at });
const reading = (text: string): LessonBlock => ({ id: "b", type: "reading", title: "t", text }) as LessonBlock;

const refs = (found: { ref: string }[]) => [...new Set(found.map((c) => c.ref))];

describe("сопоставитель курса с отсечением по уроку", () => {
  const cards = [word("w:a", "σπίτι", 0), word("w:b", "το αυτοκίνητο", 1, "мн. τα αυτοκίνητα"), word("w:c", "κρύο", 2)];
  const text = "Το σπίτι, το αυτοκίνητο και κρύο.";

  it("карточка позднего урока не находится", () => {
    const matcher = buildMatcher(cards);
    expect(refs(candidates(text, matcher, 0))).toEqual(["w:a"]);
    expect(refs(candidates(text, matcher, 1))).toEqual(["w:a", "w:b"]);
    expect(refs(candidates(text, matcher))).toEqual(["w:a", "w:b", "w:c"]);
  });
  it("lessonMarks с отсечением не размечает карточку будущего урока", () => {
    const matcher = buildMatcher(cards);
    const marked = (upto: number) =>
      Object.values(
        lessonMarks({ blocks: [reading(text)], matcher, own: new Set(), rank: () => 0, upto }).blocks,
      ).flatMap((fields) => Object.values(fields).flatMap((marks) => marks.map((mark) => mark.ref)));
    expect(marked(0)).toEqual(["w:a"]);
    expect(marked(2)).toEqual(["w:a", "w:b", "w:c"]);
  });
  it("слова и основы позднего урока не делают слово знакомым", () => {
    const measure = coverer(cards, [{ text: "ζεστός", at: 2 }]);
    expect(measure("κρύο ζεστός", [], [], 1).unknown).toEqual(["κρύο", "ζεστός"]);
    expect(measure("κρύο ζεστός", [], [], 2).unknown).toEqual([]);
  });
});

describe("минимальный урок появления", () => {
  it("слово из двух уроков знакомо с первого, а пропущенные индексы не мешают", () => {
    const measure = coverer([word("w:a", "σπίτι", 5), word("w:b", "σπίτι", 2)], [{ text: "σπίτι", at: 9 }]);
    expect(measure("σπίτι", [], [], 1).unknown).toEqual(["σπίτι"]);
    expect(measure("σπίτι", [], [], 2).unknown).toEqual([]);
  });
});

describe("отсечение равно сборке по карточкам уроков до него", () => {
  const built = buildContent("content");
  const words = new Map(built.words.map((entry) => [entry.id, entry]));
  const phrases = new Map(built.phrases.map((entry) => [entry.id, entry]));
  const lessons = built.packages.slice(0, 40);
  const all: MatchCard[] = [];
  const seen = new Set<string>();
  lessons.forEach((pack, at) => {
    for (const item of pack.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(
        item.kind === "word"
          ? { ref: item.id, text: words.get(item.id)!.greek, forms: words.get(item.id)!.forms, at }
          : { ref: item.id, text: phrases.get(item.id)!.text, phrase: true, at },
      );
    }
  });
  const glossesOf = (pack: (typeof lessons)[number]) =>
    (pack.blocks ?? []).flatMap((block) =>
      "glosses" in block && block.glosses ? block.glosses.map((g) => g.text) : [],
    );
  const textOf = (pack: (typeof lessons)[number]) =>
    (pack.blocks ?? []).flatMap((block) => (block.type === "reading" ? [block.text] : [])).join("\n");
  const fullMatcher = buildMatcher(all);
  const fullMeasure = coverer(
    all,
    lessons.flatMap((pack, at) => glossesOf(pack).map((text) => ({ text, at }))),
  );

  it("места и покрытие совпадают на каждом уроке", () => {
    let checked = 0;
    lessons.forEach((pack, at) => {
      const text = textOf(pack);
      if (!text) return;
      const prefix = all.filter((card) => card.at! <= at);
      const alone = buildMatcher(prefix);
      expect(candidates(text, fullMatcher, at)).toEqual(candidates(text, alone));
      const lessonGlosses = lessons.slice(0, at + 1).flatMap(glossesOf);
      expect(fullMeasure(text, [], [], at)).toEqual(
        coverage({ text, glosses: [], names: [], cards: prefix, lessonGlosses }),
      );
      checked++;
    });
    expect(checked).toBeGreaterThan(5);
  });
});
