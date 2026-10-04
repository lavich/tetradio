import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildContent } from "../content/build";
import { buildMatcher, candidates, choose, formPieces, lessonMarks, type MatchCard } from "../content/marks";
import { parseBlocks, type LessonBlock } from "../src/content/course";
import { ContentError, decodeMarks, parseMarks, parsePackage } from "../src/content/schema";

function found(text: string, cards: MatchCard[], rank: (ref: string) => number = () => 0) {
  const matcher = buildMatcher(cards);
  return choose(candidates(text, matcher), rank).map(
    (span) => `${text.slice(span.start, span.start + span.length)}→${span.ref}`,
  );
}
const word = (ref: string, text: string, forms?: string): MatchCard => ({ ref, text, forms });

describe("поиск слова в тексте", () => {
  it("слово без артикля и с артиклем; артикль входит в вхождение", () => {
    const cards = [word("w:filos", "ο φίλος", "мн. οι φίλοι")];
    expect(found("Ο φίλος μου. Είναι φίλος.", cards)).toEqual(["Ο φίλος→w:filos", "φίλος→w:filos"]);
  });
  it("формы из карточки без помет: мн., аор., буд. θα", () => {
    expect(formPieces("аор. έγραψα; буд. θα γράψω; повел. γράψε")).toEqual(["έγραψα", "γράψω", "γράψε"]);
    const cards = [word("w:grafo", "γράφω", "аор. έγραψα; буд. θα γράψω"), word("w:filos", "ο φίλος", "мн. οι φίλοι")];
    expect(found("Έγραψα. Θα γράψω. Οι φίλοι.", cards)).toEqual([
      "Έγραψα→w:grafo",
      "γράψω→w:grafo",
      "Οι φίλοι→w:filos",
    ]);
  });
  it("частые окончания по части речи, с тем же ударением", () => {
    const cards = [
      word("w:filos", "ο φίλος"),
      word("w:mitera", "η μητέρα"),
      word("w:meno", "μένω"),
      word("w:kalos", "καλός", "καλός, καλή, καλό"),
      word("w:anthropos", "ο άνθρωπος"),
    ];
    expect(found("φίλο, φίλους, μητέρας, μένουμε, μένουν, καλή, καλές, καλά, άνθρωπο", cards)).toEqual([
      "φίλο→w:filos",
      "φίλους→w:filos",
      "μητέρας→w:mitera",
      "μένουμε→w:meno",
      "μένουν→w:meno",
      "καλή→w:kalos",
      "καλές→w:kalos",
      "καλά→w:kalos",
      "άνθρωπο→w:anthropos",
    ]);
    // Ударение сдвигается — форма не выводится: лучше пропустить, чем ошибиться.
    expect(found("ανθρώπου μενού", cards)).toEqual([]);
  });
  it("короткая основа окончаний не получает", () => {
    expect(found("ζεις", [word("w:zo", "ζω", "аор. έζησα; буд. θα ζήσω")])).toEqual([]);
  });
  it("фраза — только целиком, с теми же знаками между словами", () => {
    const cards = [{ ref: "p:pos", text: "Πώς σε λένε;", phrase: true }, word("w:leo", "λέω")];
    expect(found("Γεια! Πώς σε λένε; Με λένε Νίκο.", cards)).toEqual(["Πώς σε λένε→p:pos", "λένε→w:leo"]);
    expect(found("Πώς, σε λένε", cards)).toEqual(["λένε→w:leo"]);
  });
  it("длинное совпадение важнее короткого", () => {
    const cards = [word("w:ora", "η ώρα"), { ref: "p:ti", text: "Τι ώρα είναι;", phrase: true }];
    expect(found("Τι ώρα είναι; Η ώρα.", cards)).toEqual(["Τι ώρα είναι→p:ti", "Η ώρα→w:ora"]);
  });
  it("границы слова: часть другого слова и слитное написание не находятся", () => {
    const cards = [word("w:ora", "η ώρα"), word("w:kalos", "καλός", "καλός, καλή, καλό")];
    expect(found("ωραία καλόςx Καλημέρα", cards)).toEqual([]);
  });
  it("регистр, NFC и конечная сигма не важны", () => {
    const decomposed = "ΦΊΛΟΣ".normalize("NFD");
    expect(found(`${decomposed} φιλοσ`, [word("w:filos", "ο φίλος")])).toEqual([`${decomposed}→w:filos`]);
  });
  it("служебные омографы отдельно не ищутся", () => {
    const matcher = buildMatcher([word("w:se", "σε"), word("w:mou", "μου"), word("w:sas", "σας")]);
    expect(choose(candidates("σε μου Σας", matcher), () => 0)).toEqual([]);
    expect(matcher.skipped).toHaveLength(3);
  });
  it("равные карточки на одном месте — спорное место, без разметки и в отчёте", () => {
    const report: string[][] = [];
    const matcher = buildMatcher([word("w:a", "κρύο"), word("w:b", "το κρύο")]);
    expect(
      choose(
        candidates("κάνει κρύο", matcher),
        () => 0,
        (_, refs) => report.push(refs),
      ),
    ).toEqual([]);
    expect(report).toEqual([["w:a", "w:b"]]);
  });
});

const blocks = (raw: unknown[]): LessonBlock[] => parseBlocks(raw, "blocks");
describe("разметка урока", () => {
  const cards = [word("w:filos", "ο φίλος"), word("w:eimai", "είμαι")];
  const matcher = buildMatcher(cards);
  const lesson = blocks([
    { type: "explanation", id: "e", body: "**Ο φίλος** μου. Ο φίλος είναι εδώ. Είμαι." },
    {
      type: "exercise",
      id: "x",
      instruction: "?",
      format: "choice",
      items: [{ id: "q", prompt: "Ο φίλος;", options: ["α", "β"], answer: "α" }],
    },
    {
      type: "reading",
      id: "r",
      title: "Τ",
      text: "Ο φίλος μου είναι εδώ.",
      glosses: [{ text: "Ο φίλος μου", russian: "мой друг" }],
    },
    { type: "listening", id: "l", title: "Τ", transcript: [{ text: "Είμαι εδώ." }, { text: "Ο φίλος." }] },
  ]);
  const own = new Set(["w:filos"]);
  const { blocks: marks } = lessonMarks({ blocks: lesson, matcher, own, rank: (ref) => (own.has(ref) ? 0 : 1) });
  it("слово урока и прошлого урока; первое вхождение в блоке", () => {
    expect(marks.e.body).toEqual([
      { start: 2, length: 7, ref: "w:filos", kind: "lesson", first: true },
      { start: 17, length: 7, ref: "w:filos", kind: "lesson", first: false },
      // «είναι» — форма неправильного είμαι.
      { start: 25, length: 5, ref: "w:eimai", kind: "earlier", first: false },
      { start: 36, length: 5, ref: "w:eimai", kind: "earlier", first: false },
    ]);
  });
  it("в таблице подчёркнуто каждое слово урока, даже если оно уже было в тексте", () => {
    const [table] = blocks([
      {
        type: "explanation",
        id: "t",
        body: "Ο φίλος.",
        table: {
          rows: [
            ["ο φίλος", "друг"],
            ["είμαι", "быть"],
          ],
        },
      },
    ]);
    const { blocks: marked } = lessonMarks({ blocks: [table], matcher, own, rank: (ref) => (own.has(ref) ? 0 : 1) });
    expect(marked.t.body[0].first).toBe(true);
    expect(marked.t["table.0.0"]).toEqual([{ start: 0, length: 7, ref: "w:filos", kind: "lesson", first: true }]);
    expect(marked.t["table.1.0"]).toEqual([{ start: 0, length: 5, ref: "w:eimai", kind: "earlier", first: false }]);
  });
  it("в заданиях разметки нет", () => {
    expect(marks.x).toBeUndefined();
  });
  it("глосса автора важнее и ведёт на карточку внутри неё", () => {
    expect(marks.r.text).toEqual([
      { start: 0, length: 11, ref: "w:filos", kind: "lesson", first: true },
      { start: 12, length: 5, ref: "w:eimai", kind: "earlier", first: false },
    ]);
  });
  it("транскрипт — по репликам; первое вхождение считается по всему блоку", () => {
    expect(marks.l["transcript.0"]).toEqual([{ start: 0, length: 5, ref: "w:eimai", kind: "earlier", first: false }]);
    expect(marks.l["transcript.1"]).toEqual([{ start: 0, length: 7, ref: "w:filos", kind: "lesson", first: true }]);
  });
});

type Files = Record<string, unknown>;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function build(files: Files) {
  const root = mkdtempSync(join(tmpdir(), "marks-"));
  roots.push(root);
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), stringify(value));
  }
  return buildContent(root);
}
/** Полный модуль: уроки a и b и контрольная с чтением, аудированием, письмом и речью без слов курса. */
const course = (): Files => ({
  "courses/c.yaml": { title: "Курс", modules: ["m01"] },
  "modules/m01.yaml": {
    number: 1,
    title: "Α",
    subtitle: "А",
    status: "published",
    goal: "—",
    sessions: 1,
    lessons: ["a", "b", "t"],
  },
  "lessons/a.yaml": {
    title: "Первый",
    items: [{ kind: "word", id: "eimai" }],
    blocks: [{ type: "explanation", id: "e", body: "Είμαι η Άννα." }],
  },
  "lessons/b.yaml": {
    title: "Второй",
    items: [{ kind: "word", id: "filos" }],
    blocks: [{ type: "explanation", id: "e", body: "Είμαι ο φίλος." }],
  },
  "lessons/t.yaml": {
    title: "Контрольная",
    kind: "test",
    items: [],
    blocks: [
      { type: "reading", id: "r", title: "Κείμενο", text: "Καλημέρα." },
      { type: "listening", id: "l", title: "Διάλογος", transcript: [{ text: "Καλημέρα." }] },
      ...["r", "l"].map((about) => ({
        type: "exercise",
        id: `${about}-q`,
        about,
        graded: true,
        instruction: "?",
        format: "choice",
        items: [{ id: "q", prompt: "Καλημέρα;", options: ["Σωστό", "Λάθος"], answer: "Σωστό" }],
      })),
      {
        type: "writing",
        id: "w",
        register: "friendly",
        prompt: "—",
        words: { min: 1, max: 5 },
        model: "Καλημέρα.",
        criteria: ["—"],
      },
      { type: "speaking", id: "s", part: "interview", prompt: "—", seconds: 10, criteria: ["—"] },
    ],
  },
  "words/eimai.yaml": { greek: "είμαι", russian: "быть", ipa: "/ˈime/", forms: "прош. ήμουν; буд. θα είμαι" },
  "words/filos.yaml": { greek: "ο φίλος", russian: "друг", forms: "мн. οι φίλοι" },
});

describe("разметка в пакете", () => {
  it("слова прошлых уроков — по порядку программы, с данными карточки и номером урока", () => {
    const content = build(course());
    const second = parsePackage(JSON.parse(JSON.stringify(content.packages.find((p) => p.id === "b"))));
    expect(second.marks!.cards).toEqual([
      {
        ref: "w:eimai",
        greek: "είμαι",
        russian: "быть",
        ipa: "/ˈime/",
        forms: "прош. ήμουν; буд. θα είμαι",
        lesson: "1.1",
      },
    ]);
    expect(decodeMarks(second.marks!, second.items).e.body).toEqual([
      { start: 0, length: 5, ref: "w:eimai", kind: "earlier", first: false },
      { start: 6, length: 7, ref: "w:filos", kind: "lesson", first: true },
    ]);
    // Слово урока в первом уроке — своё, а не прошлое; в контрольной слов нет — и разметки нет.
    expect(content.packages.find((p) => p.id === "a")!.marks!.cards).toEqual([]);
    expect(content.packages.find((p) => p.id === "t")!.marks).toBeUndefined();
    expect(content.marks.lessons.get("b")).toEqual({ lesson: 1, earlier: 1 });
  });
  it("урок без найденных слов разметки не несёт", () => {
    const files = course();
    files["lessons/a.yaml"] = {
      ...(files["lessons/a.yaml"] as object),
      blocks: [{ type: "explanation", id: "e", body: "Нет." }],
    };
    expect(build(files).packages.find((p) => p.id === "a")!.marks).toBeUndefined();
  });
  it("читатель отклоняет вхождение за текстом, пересечение и неизвестную карточку", () => {
    const lesson = blocks([{ type: "explanation", id: "e", body: "Είμαι." }]);
    const items = [{ kind: "word" as const, id: "eimai", position: 0 }];
    const marks = (entries: unknown[], refs = ["w:eimai"]) => ({ refs, cards: [], blocks: { e: { body: entries } } });
    expect(parseMarks(marks([[0, 5, 0, 1]]), lesson, items).blocks.e.body).toEqual([[0, 5, 0, 1]]);
    for (const bad of [
      marks([[3, 5, 0, 1]]),
      marks([
        [0, 3, 0, 1],
        [2, 2, 0, 0],
      ]),
      marks([[0, 5, 0, 1]], ["w:other"]),
      marks([[0, 5, 1, 0]]),
    ])
      expect(() => parseMarks(bad, lesson, items)).toThrow(ContentError);
    expect(() => parseMarks({ refs: [], cards: [], blocks: { nope: {} } }, lesson, items)).toThrow(ContentError);
  });
});
