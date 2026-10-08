import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildContent } from "../content/build";
import { lineHash } from "../content/build/voices";
import { parseBlocks, publicationGaps } from "../src/content/course";
import { ContentError, parseCatalog, parsePackage } from "../src/content/schema";

/** Минимальный курс программы: один опубликованный модуль из урока и контрольной и один черновик. */
type Files = Record<string, unknown>;
const listening = {
  type: "listening",
  id: "dialogue",
  title: "Στο καφέ",
  audio: "m01-dialogue.mp3",
  source: "Синтетическая запись для теста",
  transcript: [
    { speaker: "Άννα", text: "Γεια σου! Πώς σε λένε;" },
    { speaker: "Νίκος", text: "Με λένε Νίκο." },
  ],
};
const lesson = {
  title: "Знакомство",
  kind: "lesson",
  items: [{ kind: "word", id: "geia" }],
  blocks: [
    {
      type: "explanation",
      id: "eimai",
      title: "Глагол είμαι",
      body: "Εγώ **είμαι**.",
      table: { rows: [["εγώ", "είμαι"]] },
    },
    { type: "vocabulary", id: "words" },
    {
      type: "reading",
      id: "text",
      title: "Η Άννα",
      text: "Η Άννα είναι από την Κύπρο.",
      glosses: [{ text: "Κύπρο", russian: "Кипр" }],
    },
    {
      type: "exercise",
      id: "text-tf",
      about: "text",
      instruction: "Верно или неверно?",
      format: "choice",
      items: [{ id: "q1", prompt: "Η Άννα είναι από την Ελλάδα.", options: ["Σωστό", "Λάθος"], answer: "Λάθος" }],
    },
    listening,
    {
      type: "exercise",
      id: "dialogue-q",
      about: "dialogue",
      instruction: "Ответьте",
      format: "text",
      items: [{ id: "q1", prompt: "Πώς τον λένε;", answer: ["Νίκο", "Νίκος"], explanation: "Νίκο — вин. п." }],
    },
    {
      type: "writing",
      id: "about-me",
      register: "friendly",
      prompt: "Напишите 3 предложения о себе.",
      words: { min: 10, max: 30 },
      model: "Με λένε Άννα. Είμαι από τη Ρωσία. Μένω στη Λεμεσό.",
      criteria: ["Имя", "Страна", "Город"],
    },
    {
      type: "speaking",
      id: "intro",
      part: "interview",
      prompt: "Ответьте: Πώς σε λένε;",
      seconds: 30,
      criteria: ["Полный ответ"],
    },
  ],
};
const test = {
  title: "Контрольная",
  kind: "test",
  items: [],
  blocks: [
    {
      type: "exercise",
      id: "gaps",
      graded: true,
      instruction: "Вставьте слово",
      format: "gap",
      bank: ["είμαι", "είσαι", "είναι"],
      items: [{ id: "g1", prompt: "Εγώ ___ η Άννα.", answer: "είμαι" }],
    },
  ],
};
const base = (): Files => ({
  "courses/greek-a2.yaml": { title: "Греческий A2", modules: ["m01", "m02"] },
  "modules/m01.yaml": {
    number: 1,
    title: "Γνωριμία",
    subtitle: "Знакомство",
    status: "published",
    goal: "Представиться",
    grammar: ["είμαι"],
    sessions: 3,
    lessons: ["m01-1", "m01-test"],
  },
  "modules/m02.yaml": {
    number: 2,
    title: "Χώρες",
    subtitle: "Страны",
    status: "draft",
    goal: "Сказать, откуда ты",
    sessions: 3,
    lessons: ["m02-1"],
  },
  "lessons/m01-1.yaml": lesson,
  "lessons/m01-test.yaml": test,
  "lessons/m02-1.yaml": {
    title: "Страны",
    items: [{ kind: "word", id: "xora" }],
    blocks: [{ ...listening, audio: "not-recorded-yet.mp3", source: undefined }],
  },
  "words/geia.yaml": { greek: "γεια", russian: "привет", forms: "—" },
  "words/xora.yaml": { greek: "η χώρα", russian: "страна", forms: "мн. οι χώρες" },
  "audio/m01-dialogue.mp3": new Uint8Array([1, 2, 3]),
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function build(files: Files) {
  const root = mkdtempSync(join(tmpdir(), "course-"));
  roots.push(root);
  for (const [path, value] of Object.entries(files)) {
    if (value === undefined) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value instanceof Uint8Array ? value : stringify(value));
  }
  return buildContent(root);
}
const withLesson = (patch: (blocks: Record<string, unknown>[]) => Record<string, unknown>[]) => ({
  ...base(),
  "lessons/m01-1.yaml": { ...lesson, blocks: patch(structuredClone(lesson.blocks) as Record<string, unknown>[]) },
});
const failure = (files: Files) => {
  try {
    build(files);
  } catch (error) {
    expect(error).toBeInstanceOf(ContentError);
    return (error as Error).message;
  }
  throw new Error("сборка прошла, а должна была отказать");
};

describe("курс из модулей", () => {
  it("публикует полный модуль с блоками, а черновик — только описанием", () => {
    const content = build(base());
    const catalog = parseCatalog(
      JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string),
    );
    expect(catalog.schemaVersion).toBe(4);
    expect(catalog.courses[0]).toMatchObject({
      id: "greek-a2",
      moduleIds: ["m01", "m02"],
      lessonIds: ["m01-1", "m01-test"],
    });
    expect(catalog.modules).toEqual([
      expect.objectContaining({ id: "m01", number: 1, status: "published", lessonIds: ["m01-1", "m01-test"] }),
      expect.objectContaining({ id: "m02", number: 2, status: "draft", lessonIds: [] }),
    ]);
    expect(content.packages.map((p) => p.id)).toEqual(["m01-1", "m01-test"]);
    const pack = parsePackage(JSON.parse(JSON.stringify(content.packages[0])));
    expect(pack.lesson).toEqual({ title: "Знакомство", kind: "lesson" });
    expect(pack.module).toEqual({ id: "m01", position: 0 });
    expect(pack.blocks!.map((b) => b.type)).toEqual([
      "explanation",
      "vocabulary",
      "reading",
      "exercise",
      "listening",
      "exercise",
      "writing",
      "speaking",
    ]);
    expect(pack.words[0].forms).toBe("—");
    const audio = pack.blocks!.find((b) => b.type === "listening");
    expect(audio).toMatchObject({ audioAssetId: "snd-m01-1-dialogue", plays: 2 });
    expect(pack.media).toEqual([
      expect.objectContaining({ id: "snd-m01-1-dialogue", kind: "audio", source: listening.source }),
    ]);
    // Контрольная без карточек — урок из одних блоков.
    const exam = parsePackage(JSON.parse(JSON.stringify(content.packages[1])));
    expect(exam).toMatchObject({ items: [], lesson: { kind: "test" }, module: { id: "m01", position: 1 } });
  });
  it("черновик не поставляет уроки и медиа, но его слова не считаются лишними", () => {
    const content = build(base());
    expect(content.files.some((f) => f.path.includes("m02"))).toBe(false);
    expect(content.words.map((w) => w.id)).toContain("xora");
  });
  it("одинаковое содержимое даёт одинаковые версии пакетов", () => {
    expect(build(base()).packages.map((p) => p.version)).toEqual(build(base()).packages.map((p) => p.version));
  });
});

describe("запрет публикации неполного модуля", () => {
  it.each([
    [
      "без чтения",
      (b: Record<string, unknown>[]) => b.filter((x) => x.id !== "text" && x.id !== "text-tf"),
      "нет текста для чтения",
    ],
    [
      "без заданий к чтению",
      (b: Record<string, unknown>[]) => b.filter((x) => x.id !== "text-tf"),
      "к чтению нет заданий",
    ],
    ["без письма", (b: Record<string, unknown>[]) => b.filter((x) => x.type !== "writing"), "нет письменного задания"],
    ["без речи", (b: Record<string, unknown>[]) => b.filter((x) => x.type !== "speaking"), "нет устного задания"],
  ])("%s", (_name, patch, gap) => {
    const message = failure(withLesson(patch));
    expect(message).toContain("модуль m01 нельзя опубликовать");
    expect(message).toContain(gap);
  });
  it("без контрольной", () => {
    const files = base();
    (files["modules/m01.yaml"] as { lessons: string[] }).lessons = ["m01-1"];
    delete files["lessons/m01-test.yaml"];
    expect(failure(files)).toContain("нет контрольной");
  });
  it("контрольная без оцениваемых заданий", () => {
    expect(
      failure({ ...base(), "lessons/m01-test.yaml": { ...test, blocks: [{ ...test.blocks[0], graded: false }] } }),
    ).toContain("нет оцениваемых заданий");
  });
  it("аудиофайл, которого нет, и аудио без источника", () => {
    expect(failure({ ...base(), "audio/m01-dialogue.mp3": undefined })).toContain("файла audio/m01-dialogue.mp3 нет");
    expect(
      failure(withLesson((b) => b.map((x) => (x.type === "listening" ? { ...x, source: undefined } : x)))),
    ).toContain("у аудио нужен источник");
  });
});

describe("задания и ключи ответов", () => {
  const exercise = (patch: Record<string, unknown>) =>
    withLesson((b) => b.map((x) => (x.id === "text-tf" ? { ...x, ...patch } : x)));
  it("пункт без ответа", () => {
    expect(failure(exercise({ items: [{ id: "q1", prompt: "…", options: ["Σωστό", "Λάθος"] }] }))).toContain("answer");
  });
  it("ответ выбора не из вариантов", () => {
    expect(
      failure(exercise({ items: [{ id: "q1", prompt: "…", options: ["Σωστό", "Λάθος"], answer: "Ναι" }] })),
    ).toContain("ответ должен быть ровно одним из вариантов");
  });
  it("пропуск без «___» и ответ не из банка", () => {
    const gap = (item: Record<string, unknown>) => ({
      ...base(),
      "lessons/m01-test.yaml": { ...test, blocks: [{ ...test.blocks[0], items: [item] }] },
    });
    expect(failure(gap({ id: "g1", prompt: "Εγώ η Άννα.", answer: "είμαι" }))).toContain("нужен пропуск «___»");
    expect(failure(gap({ id: "g1", prompt: "Εγώ ___ η Άννα.", answer: "ήμουν" }))).toContain(
      "одним из вариантов банка",
    );
  });
  it("задание ссылается на блок, которого нет", () => {
    expect(failure(exercise({ about: "missing" }))).toContain("«missing» нет в уроке");
  });
});

describe("соединение (match)", () => {
  const match = {
    type: "exercise",
    id: "phrases-match",
    instruction: "Соедините русскую фразу с греческой. Одна лишняя.",
    format: "match",
    bank: ["Γεια σου!", "Με λένε Άννα.", "Τα λέμε!"],
    items: [
      { id: "m1", prompt: "Привет!", answer: "Γεια σου!" },
      { id: "m2", prompt: "Меня зовут Анна.", answer: ["Με λένε Άννα."], explanation: "λένε — «называют»" },
    ],
  };
  const withMatch = (patch: Record<string, unknown> = {}) => withLesson((b) => [...b, { ...match, ...patch }]);
  const item = (patch: Record<string, unknown>) => ({ items: [{ ...match.items[0], ...patch }, match.items[1]] });

  it("публикуется с банком, ключом из одного варианта и без вариантов у пунктов", () => {
    const pack = parsePackage(JSON.parse(JSON.stringify(build(withMatch()).packages[0])));
    expect(pack.blocks!.find((b) => b.id === "phrases-match")).toEqual({
      type: "exercise",
      id: "phrases-match",
      instruction: match.instruction,
      format: "match",
      bank: match.bank,
      items: [
        { id: "m1", prompt: "Привет!", answer: ["Γεια σου!"] },
        { id: "m2", prompt: "Меня зовут Анна.", answer: ["Με λένε Άννα."], explanation: "λένε — «называют»" },
      ],
    });
  });
  it("банк ровно из ответов — допустим", () => {
    expect(() => build(withMatch({ bank: ["Γεια σου!", "Με λένε Άννα."] }))).not.toThrow();
  });
  it("вариантов в банке меньше, чем пунктов, — ошибка с путём к банку", () => {
    const message = failure(
      withMatch({
        bank: ["Γεια σου!", "Με λένε Άννα."],
        items: [...match.items, { id: "m3", prompt: "Привет!", answer: "Γεια σου!" }],
      }),
    );
    expect(message).toContain("lessons/m01-1.yaml");
    expect(message).toContain(".bank: вариантов меньше, чем пунктов");
  });
  it("без банка — ошибка", () => {
    expect(failure(withMatch({ bank: undefined }))).toContain("у задания match нужен банк вариантов");
  });
  it("ответ не из банка или несколько ответов — ошибка", () => {
    expect(failure(withMatch(item({ answer: "Καλημέρα!" })))).toContain(
      "items[0].answer: ответ должен быть одним из вариантов банка",
    );
    expect(failure(withMatch(item({ answer: ["Γεια σου!", "Τα λέμε!"] })))).toContain(
      "ответ должен быть одним из вариантов банка",
    );
  });
  it("варианты у пункта, повтор в банке и повтор пункта — ошибки", () => {
    expect(failure(withMatch(item({ options: match.bank })))).toContain("варианты бывают только у choice");
    expect(failure(withMatch({ bank: [...match.bank, "Τα λέμε!"] }))).toContain("«Τα λέμε!» повторяется");
    expect(failure(withMatch(item({ id: "m2" })))).toContain("«m2» повторяется");
  });
  it("пустое задание — ошибка", () => {
    expect(failure(withMatch({ items: [] }))).toContain("в задании нет пунктов");
  });
});

describe("контрольные точки", () => {
  const withPoint = (extra: Files = {}): Files => {
    const files = base();
    (files["modules/m01.yaml"] as Record<string, unknown>).checkpoint = "k1";
    return { ...files, "lessons/k1.yaml": { ...test, title: "Контрольная A1" }, ...extra };
  };
  it("точка публикуется после модуля: вне его уроков, в уроках курса и в каталоге", () => {
    const content = build(withPoint());
    const catalog = parseCatalog(
      JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string),
    );
    expect(catalog.modules![0]).toMatchObject({ lessonIds: ["m01-1", "m01-test"], checkpointId: "k1" });
    expect(catalog.courses[0].lessonIds).toEqual(["m01-1", "m01-test", "k1"]);
    expect(content.packages.find((p) => p.id === "k1")).toMatchObject({
      lesson: { kind: "test" },
      module: { id: "m01", position: 2 },
    });
  });
  it("занятия после точки: обычные уроки после неё, только при точке", () => {
    const files = withPoint({ "lessons/r1.yaml": { ...lesson, title: "Слабый навык" } });
    (files["modules/m01.yaml"] as Record<string, unknown>).review = ["r1"];
    const content = build(files);
    const catalog = parseCatalog(
      JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string),
    );
    expect(catalog.modules![0]).toMatchObject({ checkpointId: "k1", reviewIds: ["r1"] });
    expect(catalog.courses[0].lessonIds).toEqual(["m01-1", "m01-test", "k1", "r1"]);
    expect(content.packages.find((p) => p.id === "r1")).toMatchObject({ module: { id: "m01", position: 3 } });
    const asTest = withPoint({ "lessons/r1.yaml": { ...test, title: "Слабый навык" } });
    (asTest["modules/m01.yaml"] as Record<string, unknown>).review = ["r1"];
    expect(failure(asTest)).toContain("после точки — урок (kind: lesson)");
    const orphan = base();
    (orphan["modules/m01.yaml"] as Record<string, unknown>).review = ["r1"];
    expect(failure({ ...orphan, "lessons/r1.yaml": { ...lesson, title: "Слабый навык" } })).toContain(
      "только у модуля с контрольной точкой",
    );
  });
  it("точка — только контрольная с оцениваемыми заданиями и не у черновика", () => {
    expect(failure(withPoint({ "lessons/k1.yaml": { ...test, kind: "lesson" } }))).toContain("должен быть контрольной");
    expect(
      failure(withPoint({ "lessons/k1.yaml": { ...test, blocks: [{ ...test.blocks[0], graded: false }] } })),
    ).toContain("нет оцениваемых заданий");
    const draft = withPoint();
    (draft["modules/m01.yaml"] as Record<string, unknown>).lessons = ["m01-1", "m01-test", "k1"];
    expect(failure(draft)).toContain("контрольная точка не входит в уроки модуля");
  });
});

describe("картинки слов из библиотеки", () => {
  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="#fb0"/></svg>',
  );
  const pictured = (extra: Files = {}) => ({
    ...base(),
    "pictures.yaml": { source: "Microsoft Fluent Emoji (Flat), MIT", words: { geia: "sun.svg" } },
    "pictures/sun.svg": svg,
    ...extra,
  });
  it("слово получает картинку как медиа пакета с источником библиотеки", () => {
    const pack = build(pictured()).packages.find((p) => p.id === "m01-1")!;
    expect(pack.words.find((w) => w.id === "geia")!.imageAssetId).toBe("img-geia");
    expect(pack.media.find((m) => m.id === "img-geia")).toMatchObject({
      kind: "image",
      mimeType: "image/svg+xml",
      source: "Microsoft Fluent Emoji (Flat), MIT",
    });
  });
  it("неизвестное слово, не SVG, скрипт и лишний файл — ошибки", () => {
    expect(failure(pictured({ "pictures.yaml": { source: "x", words: { nope: "sun.svg" } } }))).toContain(
      "слова nope нет",
    );
    expect(
      failure(
        pictured({
          "pictures.yaml": { source: "x", words: { geia: "sun.png" } },
          "pictures/sun.png": svg,
          "pictures/sun.svg": undefined,
        }),
      ),
    ).toContain("только SVG");
    expect(
      failure(pictured({ "pictures/sun.svg": new TextEncoder().encode("<svg><script>alert(1)</script></svg>") })),
    ).toContain("скрипт");
    expect(failure(pictured({ "pictures/extra.svg": svg }))).toContain("не привязана ни к одному слову");
    expect(failure(pictured({ "pictures.yaml": { words: { geia: "sun.svg" } } }))).toContain("нужен source");
  });
});

describe("шпаргалка модуля", () => {
  const withCrib = (crib: unknown) => {
    const files = base();
    files["modules/m01.yaml"] = { ...(files["modules/m01.yaml"] as object), crib };
    return files;
  };
  it("попадает в каталог парами «подпись, форма»", () => {
    const crib = {
      title: "είμαι — быть",
      rows: [
        ["εγώ", "είμαι"],
        ["εμείς", "είμαστε"],
      ],
      note: "ου [u]",
    };
    const content = build(withCrib(crib));
    const catalog = parseCatalog(
      JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string),
    );
    expect(catalog.modules![0].crib).toEqual(crib);
    expect(catalog.modules![1].crib).toBeUndefined();
  });
  it("строка не из пары, пустая таблица и лишнее поле — ошибки", () => {
    expect(failure(withCrib({ title: "x", rows: [["εγώ"], ["εσύ", "είσαι"]] }))).toContain("нужна пара");
    expect(failure(withCrib({ title: "x", rows: [["εγώ", "είμαι"]] }))).toContain("от 2 до 8 строк");
    expect(
      failure(
        withCrib({
          title: "x",
          rows: [
            ["a", "b"],
            ["c", "d"],
          ],
          table: [],
        }),
      ),
    ).toContain("лишнее поле «table»");
  });
});

describe("лишние поля", () => {
  it("хвост реплики, отрезанный запятой в YAML, — ошибка сборки, а не потерянный текст", () => {
    const split = withLesson((b) =>
      b.map((x) =>
        x.type === "listening" ? { ...x, transcript: [{ speaker: "Νίκος", text: "Χάρηκα πολύ", "Μαρίνα.": null }] } : x,
      ),
    );
    expect(failure(split)).toContain("лишнее поле «Μαρίνα.»");
  });
});

describe("смешанные алфавиты", () => {
  it("греческая буква в русском слове или латинская в греческом — ошибка; подсказка произношения в скобках — нет", () => {
    const withBody = (body: string) => withLesson((b) => b.map((x) => (x.type === "explanation" ? { ...x, body } : x)));
    expect(failure(withBody("Экзамен КΕΓ: ..."))).toContain("смешаны алфавиты");
    expect(failure(withBody("Γεια σoυ"))).toContain("смешаны алфавиты");
    expect(() => build(withBody("θ читается как [θ]: [аθи́на]. Уровень Α2."))).not.toThrow();
  });
});

describe("стабильность идентификаторов", () => {
  it("повтор идентификатора блока и недопустимый идентификатор", () => {
    expect(failure(withLesson((b) => [...b, { type: "vocabulary", id: "words" }]))).toContain("«words» повторяется");
    expect(failure(withLesson((b) => [...b, { type: "vocabulary", id: "Слова урока" }]))).toContain("только a-z");
  });
  it("номер модуля не повторяется, урок не входит в два модуля", () => {
    const twinNumber = base();
    (twinNumber["modules/m02.yaml"] as { number: number }).number = 1;
    expect(failure(twinNumber)).toContain("номер 1 уже у модуля m01");
    const twinLesson = base();
    (twinLesson["modules/m02.yaml"] as { lessons: string[] }).lessons = ["m01-1"];
    expect(failure(twinLesson)).toContain("урок m01-1 уже входит в модуль m01");
  });
  it("блоки не бывают у уроков словарного курса", () => {
    expect(
      failure({
        "courses/vocab.yaml": { title: "Слова", lessons: ["l1"] },
        "lessons/l1.yaml": { title: "Урок", items: [{ kind: "word", id: "geia" }], blocks: [] },
        "words/geia.yaml": { greek: "γεια", russian: "привет" },
      }),
    ).toContain("блоки бывают только у уроков модуля программы");
  });
});

describe("аудирование без записи", () => {
  it("публикуется с транскриптом: звук даёт синтез речи устройства, медиа не поставляется", () => {
    const content = build(
      withLesson((b) => b.map((x) => (x.type === "listening" ? { ...x, audio: undefined, source: undefined } : x))),
    );
    const pack = content.packages.find((p) => p.id === "m01-1")!;
    expect(pack.blocks!.find((b) => b.type === "listening")).not.toHaveProperty("audioAssetId");
    expect(pack.media).toEqual([]);
  });
  it("транскрипт обязателен", () => {
    expect(
      failure(
        withLesson((b) => b.map((x) => (x.type === "listening" ? { ...x, audio: undefined, transcript: [] } : x))),
      ),
    ).toContain("у аудио нужен транскрипт");
  });
});

describe("клиентская проверка", () => {
  it("черновик в каталоге не может объявлять уроки", () => {
    const content = build(base());
    const raw = JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string);
    raw.modules[1].lessonIds = ["m01-1"];
    expect(() => parseCatalog(raw)).toThrow("уроки черновика не поставляются");
  });
  it("правило полноты считается по всем урокам модуля", () => {
    const blocks = parseBlocks(
      lesson.blocks.map((b) => (b.type === "listening" ? { ...b, audio: undefined } : b)),
      "t",
    );
    expect(publicationGaps([{ id: "l", kind: "lesson", blocks }])).toEqual(["нет контрольной (урок с kind: test)"]);
    expect(publicationGaps([])).toEqual(["в модуле нет уроков"]);
  });
});

describe("голоса аудирования", () => {
  const voicesMap = (characters: Record<string, { gender: string; voice: string }>) => ({
    source: "Синтез речи Google Cloud TTS, голос Chirp 3 HD {voice}",
    language: "el-GR",
    prefix: "el-GR-Chirp3-HD-",
    pools: { female: ["Aoede", "Kore"], male: ["Charon", "Puck"] },
    characters,
  });
  const cast = {
    Άννα: { gender: "female", voice: "Aoede" },
    Νίκος: { gender: "male", voice: "Charon" },
  };
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const voiced = () =>
    withLesson((blocks) =>
      blocks.map((block) =>
        block.type === "listening"
          ? {
              ...block,
              transcript: [
                { speaker: "Άννα", text: "Γεια σου! Πώς σε λένε;", audio: "m01-1/dialogue-1.mp3" },
                { speaker: "Νίκος", text: "Με λένε Νίκο." },
              ],
            }
          : block,
      ),
    );
  const files = (manifest: Record<string, { voice: string; hash: string }>, characters = cast) => ({
    ...voiced(),
    "voices/el.yaml": voicesMap(characters),
    "audio/m01-1/dialogue-1.mp3": new Uint8Array([7, 7, 7]),
    "audio/dialogues.json": json(manifest),
  });
  const fresh = { "m01-1/dialogue-1.mp3": { voice: "Aoede", hash: lineHash("Γεια σου! Πώς σε λένε;", "Aoede") } };

  it("запись реплики — медиа пакета с версией в имени и источником голоса; в реплику её кладёт разбор пакета", () => {
    const content = build(files(fresh));
    const raw = JSON.parse(JSON.stringify(content.packages[0])) as Record<string, unknown>;
    expect(raw.lineAudio).toEqual({ dialogue: ["line-m01-1-dialogue-1", null] });
    const pack = parsePackage(raw);
    const media = pack.media.find((item) => item.id === "line-m01-1-dialogue-1")!;
    expect(media).toMatchObject({
      kind: "audio",
      mimeType: "audio/mpeg",
      source: "Синтез речи Google Cloud TTS, голос Chirp 3 HD Aoede",
    });
    expect(media.url).toMatch(/^content\/media\/line-m01-1-dialogue-1@[0-9a-f]{10}\.mp3$/);
    expect(content.files.some((file) => file.path === media.url)).toBe(true);
    const listening = pack.blocks!.find((block) => block.type === "listening")!;
    expect(listening.type === "listening" && listening.transcript.map((line) => line.audioAssetId)).toEqual([
      "line-m01-1-dialogue-1",
      undefined,
    ]);
    expect(content.voicing).toMatchObject({ voiced: 1, stale: [] });
    expect([...content.voicing.unvoiced]).toEqual([["m01-1", 1]]);
  });
  it("запись, сделанная до правки текста или смены голоса, не публикуется: реплика звучит синтезом", () => {
    const content = build(
      files({ "m01-1/dialogue-1.mp3": { voice: "Aoede", hash: lineHash("Старый текст", "Aoede") } }),
    );
    expect(content.packages[0].lineAudio).toBeUndefined();
    expect(content.voicing.stale).toEqual(["m01-1/dialogue#1"]);
    const recast = build(files(fresh, { ...cast, Άννα: { gender: "female", voice: "Kore" } }));
    expect(recast.voicing.stale).toEqual(["m01-1/dialogue#1"]);
  });
  it("говорящий без голоса в карте отклоняет сборку", () => {
    expect(failure(files(fresh, { Άννα: cast.Άννα } as typeof cast))).toMatch(/«Νίκος» нет голоса в voices\/el\.yaml/);
  });
  it("два говорящих одного диалога с одним голосом отклоняют сборку", () => {
    expect(failure(files(fresh, { ...cast, Νίκος: { gender: "female", voice: "Aoede" } }))).toMatch(
      /у «Άννα» и «Νίκος» один голос Aoede/,
    );
  });
  it("голос не из пула своего пола отклоняет сборку", () => {
    expect(failure(files(fresh, { ...cast, Νίκος: { gender: "male", voice: "Kore" } }))).toMatch(
      /голос Kore не из пула male/,
    );
  });
  it("у записи реплики нужен источник: без него в карте голосов сборка отклонена", () => {
    const noSource = { ...files(fresh), "voices/el.yaml": { ...voicesMap(cast), source: undefined } };
    expect(failure(noSource)).toMatch(/voices\/el\.yaml\.source: поле обязательно/);
    const noVoice = { ...files(fresh), "voices/el.yaml": { ...voicesMap(cast), source: "Синтез речи" } };
    expect(failure(noVoice)).toMatch(/имя голоса/);
    const noMap = { ...files(fresh), "voices/el.yaml": undefined };
    expect(failure(noMap)).toMatch(/карты голосов voices\/el\.yaml/);
  });
  it("файла записи нет — сборка отклонена", () => {
    expect(failure({ ...files(fresh), "audio/m01-1/dialogue-1.mp3": undefined })).toMatch(
      /файла audio\/m01-1\/dialogue-1\.mp3 нет/,
    );
  });
  it("пакет с записями реплик, не совпадающими с транскриптом или медиа, отклоняется", () => {
    const raw = JSON.parse(JSON.stringify(build(files(fresh)).packages[0])) as Record<string, unknown>;
    expect(() => parsePackage({ ...raw, lineAudio: { dialogue: ["line-m01-1-dialogue-1"] } })).toThrow(
      /записей 1, а реплик 2/,
    );
    expect(() => parsePackage({ ...raw, lineAudio: { dialogue: ["нет-такого", null] } })).toThrow(/нет в пакете/);
    expect(() => parsePackage({ ...raw, lineAudio: { text: [null] } })).toThrow(/аудирования с таким id нет/);
  });
});
