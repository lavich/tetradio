import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildContent } from "../content/build";
import { buildMatcher, candidates, choose, formPieces, lessonMarks, type MatchCard } from "../content/marks";
import { parseBlocks, tapFields, type LessonBlock } from "../src/content/course";
import { ContentError, decodeMarks, parseMarks, parsePackage, readingBlock } from "../src/content/schema";
import { realContent } from "./helpers/real-content";

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

describe("частые формы", () => {
  const phone = word("w:tilefono", "το τηλέφωνο", "мн. τα τηλέφωνα");
  const family = word("w:oikogeneia", "η οικογένεια", "мн. οι οικογένειες");
  it("слово с ударением перед энклитикой находится без второго ударения", () => {
    expect(found("Το τηλέφωνό μου", [phone])).toEqual(["Το τηλέφωνό→w:tilefono"]);
    expect(found("το **τηλέφωνό** μου", [phone])).toEqual(["τηλέφωνό→w:tilefono"]);
    expect(found("την οικογένειά μας", [family])).toEqual(["οικογένειά→w:oikogeneia"]);
  });
  it("второе ударение без энклитики или через конец предложения не снимается", () => {
    expect(found("το τηλέφωνό. Μου λέει", [phone])).toEqual([]);
    expect(found("τηλέφωνό; Μου", [phone])).toEqual([]);
    expect(found("τηλέφωνό και", [phone])).toEqual([]);
  });
  it("существительное на -ές, основа из двух букв с ударением, односложное -ος, -ύς", () => {
    const cards = [
      word("w:kafes", "ο καφές", "мн. οι καφέδες"),
      word("w:kanapes", "ο καναπές", "мн. οι καναπέδες"),
      word("w:olos", "όλος", "όλος, όλη, όλο"),
      word("w:omos", "ο ώμος", "мн. οι ώμοι"),
      word("w:gios", "ο γιος", "мн. οι γιοι"),
      word("w:polys", "πολύς", "πολύς, πολλή, πολύ"),
    ];
    expect(found("καφέ, καναπέ, όλοι, όλα, όλους, ώμο, γιο, γιους, πολλά, πολλοί", cards)).toEqual([
      "καφέ→w:kafes",
      "καναπέ→w:kanapes",
      "όλοι→w:olos",
      "όλα→w:olos",
      "όλους→w:olos",
      "ώμο→w:omos",
      "γιο→w:gios",
      "γιους→w:gios",
      "πολλά→w:polys",
      "πολλοί→w:polys",
    ]);
  });
  it("сослагательные λέω — от «θα πω»", () => {
    expect(found("πείτε, πεις", [word("w:leo", "λέω", "аор. είπα; буд. θα πω")])).toEqual([
      "πείτε→w:leo",
      "πεις→w:leo",
    ]);
  });
  it("у наречия на -ω формы глагола не выводятся", () => {
    expect(found("έξει", [word("w:exo", "έξω")])).toEqual([]);
  });
  it("формы глагола — из таблицы спряжения", () => {
    const cards: MatchCard[] = [
      {
        ...word("w:doulevo", "δουλεύω", "аор. δούλεψα; буд. θα δουλέψω"),
        paradigm: ["δουλεύω", "δουλεύεις", "δουλεύει", "δουλεύουμε", "δουλεύετε", "δουλεύουν"],
      },
      {
        ...word("w:pigaino", "πηγαίνω", "аор. πήγα; буд. θα πάω"),
        paradigm: ["πήγα", "πήγες", "πήγε", "πήγαμε", "πήγατε", "πήγαν"],
      },
    ];
    expect(found("δουλεύει, πήγαμε", cards)).toEqual(["δουλεύει→w:doulevo", "πήγαμε→w:pigaino"]);
    expect(
      found(
        "δουλεύει, πήγαμε",
        cards.map(({ paradigm: _, ...card }) => card),
      ),
    ).toEqual([]);
  });
  it("глосса с омографом формы и существительным показывает перевод глоссы", () => {
    const cards = [word("w:kafes", "ο καφές", "мн. οι καφέδες"), word("w:papoutsi", "το παπούτσι", "мн. τα παπούτσια")];
    const text = "Η ζώνη ταιριάζει με τα καφέ παπούτσια του.";
    const marksOf = (glosses: { text: string; russian: string }[]) =>
      lessonMarks({
        blocks: blocks([{ type: "reading", id: "r", title: "Τ", text, ...(glosses.length ? { glosses } : {}) }]),
        matcher: buildMatcher(cards),
        own: new Set(),
        rank: () => 1,
      }).blocks.r?.text.map((mark) => `${text.slice(mark.start, mark.start + mark.length)}→${mark.ref}`) ?? [];
    expect(marksOf([{ text: "καφέ παπούτσια", russian: "коричневые туфли" }])).toEqual([]);
    expect(marksOf([])).toEqual(["καφέ→w:kafes", "παπούτσια→w:papoutsi"]);
  });
});

const withoutArticle = (span: string) => span.replace(/^(?:ο|η|το|οι|τα|τον|την|τη|του|της|των|τους|τις) /iu, "");
function marksOf(surface: string, owner?: string) {
  const sources = realContent().packages.flatMap((pack) => [
    { owner: pack.id, blocks: pack.blocks ?? [], marks: pack.marks },
    ...(pack.readings ?? []).map((reading) => ({
      owner: reading.id,
      blocks: [readingBlock(reading)],
      marks: reading.marks,
    })),
  ]);
  return sources
    .filter((source) => source.marks && (owner === undefined || source.owner === owner))
    .flatMap(({ blocks: list, marks }) =>
      list.flatMap((block) =>
        tapFields(block).flatMap(([field, text]) =>
          (marks!.blocks[block.id]?.[field] ?? [])
            .filter(([start, length]) => withoutArticle(text.slice(start, start + length)) === surface)
            .map(([, , index]) => marks!.refs[index]),
        ),
      ),
    );
}
const markedAs = (surface: string, owner?: string) => [...new Set(marksOf(surface, owner))];

describe("частые формы в настоящем курсе", () => {
  it("формы таблицы спряжения, -ές, основа из двух букв, односложное -ος и ударение перед энклитикой", () => {
    expect(markedAs("δουλεύει", "m02-1")).toEqual(["w:w038"]);
    expect(markedAs("έχει", "m03-1")).toEqual(["w:w071"]);
    expect(markedAs("γιο", "m03-1")).toEqual(["w:w088"]);
    expect(markedAs("οικογένειά", "m03-1")).toEqual(["w:w083"]);
    expect(markedAs("όλοι", "m03-3")).toEqual(["w:w102"]);
    expect(markedAs("τηλέφωνό", "m04-2")).toEqual(["w:w929"]);
    expect(markedAs("καναπέ", "m07-2")).toEqual(["w:w259"]);
    expect(markedAs("καφέ", "m08-1")).toEqual(["w:w277"]);
    expect(markedAs("πήγαμε", "m14-3")).toEqual(["w:w065"]);
  });
  it("текст для чтения размечает форму таблицы так же, как урок", () => {
    expect(markedAs("πήγαμε", "r-m20-agonas")).toEqual(["w:w065"]);
  });
  it("неправильные и одиночные формы из строки форм карточки", () => {
    expect(markedAs("τρεις", "m01-2")).toEqual(["w:w024"]);
    expect(markedAs("τέσσερις")).toContain("w:w025");
    expect(markedAs("εννιά")).toContain("w:w030");
    expect(markedAs("ένας")).toContain("w:w022");
    expect(markedAs("πολλά", "m03-2")).toEqual(["w:w099"]);
    expect(markedAs("πες", "m09-2")).toEqual(["w:w069"]);
    expect(markedAs("πείτε", "m09-2")).toEqual(["w:w069"]);
    expect(markedAs("πάρε", "m12-1")).toEqual(["w:w145"]);
    expect(markedAs("χρονών", "m08-k1")).toEqual(["w:w184"]);
    expect(markedAs("μένα", "m20-1")).toEqual(["w:w010"]);
    expect(markedAs("αυτοί", "m01-1")).toEqual(["w:w012"]);
  });
  it("«καφέ» — «коричневый» в тексте для чтения закрыт глоссами", () => {
    expect(marksOf("καφέ", "r-m11-allagi")).toEqual(["w:w277"]);
  });
  it("перевод αυτός — без греческих букв, с родами", () => {
    expect(realContent().words.find((w) => w.id === "w012")!.russian).toBe("он, она, оно; этот; мн. они");
  });
  it("новые карточки — каждая в уроке первого появления слова", () => {
    const lessons = {
      w932: "m03-2",
      w933: "m05-2",
      w934: "m06-1",
      w935: "m09-2",
      w936: "m10-1",
      w937: "m10-1",
      w938: "m11-1",
      w939: "m11-1",
      w940: "m16-1",
      w941: "m23-2",
    };
    for (const [id, lesson] of Object.entries(lessons))
      expect(
        realContent()
          .packages.filter((pack) => pack.items.some((item) => item.kind === "word" && item.id === id))
          .map((pack) => pack.id),
        id,
      ).toEqual([lesson]);
    expect(markedAs("μην", "m16-1")).toEqual(["w:w940"]);
    expect(markedAs("Ορίστε", "m09-2")).toEqual(["w:w935"]);
    expect(markedAs("Έλα", "m06-1")).toEqual(["w:w934"]);
    expect(markedAs("φρούτα", "m10-1")).toEqual(["w:w936"]);
    expect(markedAs("ροζ", "m11-1")).toEqual(["w:w938"]);
    expect(markedAs("βεβαίως", "m23-2")).toEqual(["w:w941"]);
    expect(markedAs("φορές", "r-m05-mera")).toEqual(["w:w933"]);
    expect(markedAs("δασκάλα", "m03-2")).toEqual(["w:w932"]);
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
  "words/c/eimai.yaml": {
    greek: "είμαι",
    russian: "быть",
    ipa: "/ˈime/",
    forms: "прош. ήμουν; буд. θα είμαι",
    paradigm: {
      present: ["είμαι", "είσαι", "είναι", "είμαστε", "είστε", "είναι"],
      past: ["ήμουν", "ήσουν", "ήταν", "ήμασταν", "ήσασταν", "ήταν"],
    },
  },
  "words/c/filos.yaml": { greek: "ο φίλος", russian: "друг", forms: "мн. οι φίλοι" },
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

describe("обломки слов не подсвечиваются", () => {
  const zo = [word("w:zo", "ζω", "аор. έζησα; буд. θα ζήσω")];
  it("слог после разметки, дефиса или тире — не слово", () => {
    expect(found("δια**βά**ζω; ε-τοι-μά-ζω; **-ζω**; -ζω", zo)).toEqual([]);
    const dyo = [word("w:dyo", "δύο")];
    expect(found("ένα-δύο-τρία; δύο-τρεις-τέσσερις; **δύο**-**τρεις**", dyo)).toEqual([
      "δύο→w:dyo",
      "δύο→w:dyo",
      "δύο→w:dyo",
    ]);
    expect(found("δύο-**τρεις**", [word("w:dyo", "δύο")])).toEqual(["δύο→w:dyo"]);
    expect(found("**Ζω** εδώ. Ζω, ζεις. «Ζω».", zo)).toEqual(["Ζω→w:zo", "Ζω→w:zo", "Ζω→w:zo"]);
  });
  it("в настоящем курсе нет подсветки ζω в «διαβάζω» и «-ζω»", () => {
    const zoRef = `w:${realContent().words.find((w) => w.greek === "ζω")!.id}`;
    const hits = realContent().packages.flatMap((pack) => {
      const idx = pack.marks?.refs.indexOf(zoRef) ?? -1;
      if (idx < 0) return [];
      return Object.entries(pack.marks!.blocks).flatMap(([block, fields]) =>
        Object.entries(fields).flatMap(([field, marks]) =>
          marks.filter((mark) => mark[2] === idx).map((mark) => `${pack.id} ${block}.${field}@${mark[0]}`),
        ),
      );
    });
    expect(hits.filter((hit) => /^m(05-1|14-1) /.test(hit))).toEqual([]);
    expect(hits).toContain("m24-m3 life-in-cyprus.model@0");
  });
});
