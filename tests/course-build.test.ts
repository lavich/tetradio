import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildContent } from "../content/build";
import { planAnswerVoices } from "../content/build/answers";
import { lineHash, spokenText } from "../content/build/voices";
import { PROFILES } from "../src/domain/language";
import { parseBlocks, publicationGaps } from "../src/content/course";
import { ContentError, parseCatalog, parsePackage } from "../src/content/schema";

const EL = { language: "el-GR", respell: new Map<string, string>() };

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
  "words/greek-a2/geia.yaml": { greek: "γεια", russian: "привет", forms: "—" },
  "words/greek-a2/xora.yaml": { greek: "η χώρα", russian: "страна", forms: "мн. οι χώρες" },
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

describe("частично опубликованный модуль", () => {
  const partial = (module: Record<string, unknown> = {}): Files => {
    const files: Files = withLesson((b) => b.filter((x) => x.type !== "writing" && x.type !== "speaking"));
    files["modules/m01.yaml"] = {
      ...(files["modules/m01.yaml"] as Record<string, unknown>),
      lessons: ["m01-1"],
      partial: true,
      ...module,
    };
    delete files["lessons/m01-test.yaml"];
    return files;
  };
  it("поставляет уроки без письма, речи и контрольной и называет недостающее в отчёте", () => {
    const content = build(partial());
    expect(content.packages.map((p) => p.id)).toEqual(["m01-1"]);
    expect(content.partial).toEqual([
      { id: "m01", gaps: ["нет письменного задания", "нет устного задания", "нет контрольной (урок с kind: test)"] },
    ]);
    const catalog = JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string);
    expect(catalog.modules[0]).toMatchObject({ id: "m01", status: "published", lessonIds: ["m01-1"] });
    expect(catalog.modules[0]).not.toHaveProperty("partial");
    parseCatalog(catalog);
  });
  it("без поля — прежний отказ", () => {
    const files = partial();
    delete (files["modules/m01.yaml"] as Record<string, unknown>).partial;
    expect(failure(files)).toContain("модуль m01 нельзя опубликовать");
  });
  it("у полного модуля отчёт пуст", () => {
    expect(build(base()).partial).toEqual([]);
  });
  it.each([
    ["черновик", { status: "draft" }],
    ["false", { partial: false }],
    ["строка", { partial: "yes" }],
  ])("%s — ошибка с файлом модуля и полем", (_name, module) => {
    expect(failure(partial(module))).toContain("modules/m01.yaml.partial");
  });
  it("урок без блоков в частичном модуле — отказ с уроком", () => {
    const files = partial();
    (files["modules/m01.yaml"] as { lessons: string[] }).lessons = ["m01-1", "m01-2"];
    files["lessons/m01-2.yaml"] = { title: "Пустой", kind: "lesson", items: [{ kind: "word", id: "geia" }] };
    expect(failure(files)).toContain("урок m01-2: нет блоков");
  });
  it("контрольная без оцениваемых заданий в частичном модуле — отказ", () => {
    const files = partial({ lessons: ["m01-1", "m01-test"] });
    files["lessons/m01-test.yaml"] = { ...test, blocks: [{ ...test.blocks[0], graded: false }] };
    expect(failure(files)).toContain("контрольная m01-test: нет оцениваемых заданий");
  });
});

describe("карточки курсов одного языка", () => {
  const englishCourse = (
    id: string,
    module: string,
    cards: Files,
    palette: string,
    language = "en",
    blocks: Record<string, unknown>[] = [{ type: "vocabulary", id: "words" }],
  ): Files => {
    const items = Object.keys(cards).map((path) => ({
      kind: path.startsWith("words/") ? "word" : "phrase",
      id: path.split("/").pop()!.replace(".yaml", ""),
    }));
    return {
      [`courses/${id}.yaml`]: { title: id, language, modules: [module], palette },
      [`modules/${module}.yaml`]: {
        number: 1,
        title: "Start",
        subtitle: "Начало",
        status: "draft",
        goal: "Начать",
        sessions: 3,
        lessons: [`${module}-1`],
      },
      [`lessons/${module}-1.yaml`]: {
        title: "Начало",
        kind: "lesson",
        items,
        blocks,
      },
      ...cards,
    };
  };
  const phrase = (text: string, translation: string) => ({
    text,
    translation,
    provenance: { sourceLabel: "Тест", operation: "requested-generation", request: "Тест" },
  });
  const twoCourses = (it: Files, travel: Files): Files => ({
    ...base(),
    ...englishCourse("english-it", "e01", it, "ink"),
    ...englishCourse("english-travel", "t01", travel, "coast"),
  });
  it("слово с артиклем и без в двух курсах одного языка — ошибка с обоими файлами", () => {
    const message = failure(
      twoCourses(
        { "words/english-it/ew001.yaml": { greek: "a stakeholder", russian: "заинтересованная сторона" } },
        { "words/english-travel/tw001.yaml": { greek: "Stakeholder", russian: "участник" } },
      ),
    );
    expect(message).toContain("words/english-it/ew001.yaml");
    expect(message).toContain("words/english-travel/tw001.yaml");
  });
  it("фраза с другим регистром и без знаков в двух курсах одного языка — ошибка с обоими файлами", () => {
    const message = failure(
      twoCourses(
        { "phrases/english-it/ep001.yaml": phrase("Does that answer your question?", "Это ответ на ваш вопрос?") },
        { "phrases/english-travel/tp001.yaml": phrase("does that answer your  question", "Я ответил?") },
      ),
    );
    expect(message).toContain("phrases/english-it/ep001.yaml");
    expect(message).toContain("phrases/english-travel/tp001.yaml");
  });
  it("фразовый глагол и существительное через дефис — разные карточки", () => {
    const files = twoCourses(
      { "words/english-it/ew001.yaml": { greek: "check in", russian: "зарегистрироваться" } },
      { "words/english-travel/tw001.yaml": { greek: "a check-in", russian: "регистрация" } },
    );
    expect(() => build(files)).not.toThrow();
  });
  it("существительное с артиклем и глагол с to в двух курсах — разные карточки", () => {
    const files = twoCourses(
      { "words/english-it/ew001.yaml": { greek: "a book", russian: "книга" } },
      { "words/english-travel/tw001.yaml": { greek: "to book", russian: "бронировать" } },
    );
    expect(() => build(files)).not.toThrow();
  });
  it("греческое слово с артиклем и без в двух курсах — разные карточки", () => {
    const files = {
      ...base(),
      ...englishCourse(
        "greek-travel",
        "g01",
        { "words/greek-travel/gw001.yaml": { greek: "χώρα", russian: "страна", forms: "мн. χώρες" } },
        "ink",
        "el",
      ),
    };
    expect(() => build(files)).not.toThrow();
  });
  it("слово с разными апострофами в двух курсах одного языка — ошибка", () => {
    expect(
      failure(
        twoCourses(
          { "words/english-it/ew001.yaml": { greek: "o'clock", russian: "час (о времени)" } },
          { "words/english-travel/tw001.yaml": { greek: "o’clock", russian: "ровно (о времени)" } },
        ),
      ),
    ).toContain("words/english-it/ew001.yaml");
  });
  it("слово с артиклем и без внутри одного курса с разными переводами — разные карточки", () => {
    const files = twoCourses(
      {
        "words/english-it/ew001.yaml": { greek: "a light", russian: "лампа" },
        "words/english-it/ew002.yaml": { greek: "light", russian: "лёгкий" },
      },
      {},
    );
    expect(() => build(files)).not.toThrow();
  });
  it("слово карточки курса для путешествий в тексте урока IT-курса без своей карточки — сборка проходит", () => {
    const files = {
      ...base(),
      ...englishCourse(
        "english-it",
        "e01",
        { "words/english-it/ew001.yaml": { greek: "a deadline", russian: "срок" } },
        "ink",
        "en",
        [
          { type: "vocabulary", id: "words" },
          { type: "reading", id: "text", title: "A trip", text: "The deadline is after my layover in Dubai." },
        ],
      ),
      ...englishCourse(
        "english-travel",
        "t01",
        { "words/english-travel/tw001.yaml": { greek: "a layover", russian: "пересадка" } },
        "coast",
      ),
    };
    expect(() => build(files)).not.toThrow();
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

describe("календарь курса", () => {
  const calendar = {
    start: "2026-10-05",
    checkpoints: [{ label: "K1", title: "Контрольная A1", afterModule: 2, date: "2026-12-13" }],
  };
  const withCalendar = (value: unknown, passShare?: unknown): Files => {
    const files = base();
    files["courses/greek-a2.yaml"] = {
      ...(files["courses/greek-a2.yaml"] as Record<string, unknown>),
      calendar: value,
      ...(passShare !== undefined ? { passShare } : {}),
    };
    return files;
  };
  const catalogOf = (files: Files) =>
    parseCatalog(JSON.parse(build(files).files.find((f) => f.path === "content/catalog.json")!.body as string));
  it("начало, точки и порог навыка едут в каталоге", () => {
    const course = catalogOf(withCalendar(calendar, 0.6)).courses[0];
    expect(course.calendar).toEqual(calendar);
    expect(course.passShare).toBe(0.6);
    expect(failure(withCalendar(calendar, 60))).toContain("passShare: ожидалась доля");
    expect(catalogOf(base()).courses[0].calendar).toBeUndefined();
  });
  it("дата, модуль точки и лишние поля проверяются", () => {
    const point = calendar.checkpoints[0];
    expect(failure(withCalendar({ ...calendar, start: "5 октября" }))).toContain("calendar.start: дата в формате");
    expect(failure(withCalendar({ ...calendar, checkpoints: [{ ...point, date: "2026-13" }] }))).toContain(
      "checkpoints[0].date: дата в формате",
    );
    expect(failure(withCalendar({ ...calendar, checkpoints: [{ ...point, afterModule: 8 }] }))).toContain(
      "afterModule: модуля 8 нет в курсе",
    );
    expect(failure(withCalendar({ ...calendar, checkpoints: [point, { ...point, date: "2027-01-10" }] }))).toContain(
      "метка «K1» повторяется",
    );
    expect(
      failure(withCalendar({ ...calendar, checkpoints: [point, { ...point, label: "M1", date: "2026-11-01" }] })),
    ).toContain("точки идут по датам");
    expect(failure(withCalendar({ ...calendar, end: "2027-05-02" }))).toContain("calendar: лишнее поле «end»");
    expect(failure(withCalendar({ ...calendar, checkpoints: [{ ...point, module: 2 }] }))).toContain(
      "лишнее поле «module»",
    );
  });
});

describe("данные курса для выбора", () => {
  const withCourse = (fields: Record<string, unknown>): Files => {
    const files = base();
    files["courses/greek-a2.yaml"] = { ...(files["courses/greek-a2.yaml"] as Record<string, unknown>), ...fields };
    return files;
  };
  const englishCourse = (fields: Record<string, unknown>): Files => ({
    "courses/english-it.yaml": { title: "Английский", language: "en", modules: ["e01"], ...fields },
    "modules/e01.yaml": {
      number: 1,
      title: "Work",
      subtitle: "Работа",
      status: "draft",
      goal: "Рассказать",
      sessions: 3,
    },
  });
  const catalogOf = (files: Files) =>
    parseCatalog(JSON.parse(build(files).files.find((f) => f.path === "content/catalog.json")!.body as string));

  it("уровень, цель, короткое имя и место едут в каталоге", () => {
    const fields = { level: "A0 → A2", goal: "С нуля до экзамена", short: "Греческий", order: 1 };
    expect(catalogOf(withCourse(fields)).courses[0]).toMatchObject(fields);
    expect(catalogOf(withCourse({ level: "B1 → B1+" })).courses[0].level).toBe("B1 → B1+");
  });
  it("без полей курса в каталоге их нет", () => {
    const course = catalogOf(base()).courses[0];
    for (const field of ["level", "goal", "short", "order"]) expect(course).not.toHaveProperty(field);
  });
  it("курсы в каталоге — по месту, без места — после, по id", () => {
    const ordered = { ...withCourse({ order: 1 }), ...englishCourse({ order: 2 }) };
    expect(catalogOf(ordered).courses.map((course) => course.id)).toEqual(["greek-a2", "english-it"]);
    const unordered = { ...withCourse({ order: 1 }), ...englishCourse({}) };
    expect(catalogOf(unordered).courses.map((course) => course.id)).toEqual(["greek-a2", "english-it"]);
    expect(catalogOf({ ...base(), ...englishCourse({}) }).courses.map((course) => course.id)).toEqual([
      "english-it",
      "greek-a2",
    ]);
  });
  it("неверные поля отклоняются с файлом и именем поля", () => {
    for (const level of ["B3", "A2 -> B1", "A2 → ", ""])
      expect(failure(withCourse({ level }))).toMatch(/courses\/greek-a2\.yaml\.level/);
    expect(failure(withCourse({ goal: "Первая строка\nвторая" }))).toMatch(/courses\/greek-a2\.yaml\.goal/);
    expect(failure(withCourse({ goal: "а".repeat(91) }))).toMatch(/courses\/greek-a2\.yaml\.goal/);
    expect(() => build(withCourse({ goal: "а".repeat(90) }))).not.toThrow();
    expect(failure(withCourse({ short: "Английский для поездок" }))).toMatch(/courses\/greek-a2\.yaml\.short/);
    for (const order of [0, 1.5, "1"]) expect(failure(withCourse({ order }))).toMatch(/courses\/greek-a2\.yaml\.order/);
  });
  it("одно место у двух курсов — ошибка с обоими файлами", () => {
    const message = failure({ ...withCourse({ order: 1 }), ...englishCourse({ order: 1 }) });
    expect(message).toContain("order");
    expect(message).toContain("courses/greek-a2.yaml");
    expect(message).toContain("courses/english-it.yaml");
  });
  it("клиент: неверное поле выбора курса отбрасывается, каталог читается; неизвестное поле пропускается", () => {
    const catalog = JSON.parse(build(base()).files.find((f) => f.path === "content/catalog.json")!.body as string);
    const course = parseCatalog({
      ...catalog,
      courses: [
        {
          ...catalog.courses[0],
          order: 0,
          level: "Pre-A1 → A1",
          short: "а".repeat(30),
          palette: "rainbow",
          goal: "Цель",
          future: 1,
        },
      ],
    }).courses[0];
    for (const field of ["order", "level", "short", "palette", "future"]) expect(course).not.toHaveProperty(field);
    expect(course.goal).toBe("Цель");
  });
  const travelCourse = (fields: Record<string, unknown>): Files => ({
    "courses/english-travel.yaml": { title: "Для путешествий", language: "en", modules: ["t01"], ...fields },
    "modules/t01.yaml": {
      number: 1,
      title: "Trip",
      subtitle: "Поездка",
      status: "draft",
      goal: "Собраться",
      sessions: 3,
    },
  });
  it("короткое имя «Для путешествий» проходит, из 21 символа — отказ с файлом и полем", () => {
    expect(catalogOf(withCourse({ short: "Для путешествий" })).courses[0].short).toBe("Для путешествий");
    expect(() => build(withCourse({ short: "а".repeat(20) }))).not.toThrow();
    expect(failure(withCourse({ short: "а".repeat(21) }))).toMatch(/courses\/greek-a2\.yaml\.short/);
  });
  it("одно короткое имя у двух курсов языка без учёта регистра — ошибка с обоими файлами", () => {
    const message = failure({
      ...base(),
      ...englishCourse({ short: "Для IT", palette: "ink" }),
      ...travelCourse({ short: "для it", palette: "coast" }),
    });
    expect(message).toContain("short");
    expect(message).toContain("courses/english-it.yaml");
    expect(message).toContain("courses/english-travel.yaml");
  });
  it("одно короткое имя у курсов разных языков проходит", () => {
    expect(() =>
      build({ ...withCourse({ short: "Основной" }), ...englishCourse({ short: "Основной" }) }),
    ).not.toThrow();
  });
  it("гамма едет в каталоге, без поля её нет", () => {
    const catalog = catalogOf({ ...base(), ...englishCourse({ palette: "ink" }) });
    expect(catalog.courses.find((course) => course.id === "english-it")?.palette).toBe("ink");
    expect(catalog.courses.find((course) => course.id === "greek-a2")).not.toHaveProperty("palette");
  });
  it("неизвестная гамма — отказ с файлом и полем", () => {
    expect(failure(withCourse({ palette: "rainbow" }))).toMatch(/courses\/greek-a2\.yaml\.palette/);
  });
  it("одна гамма у двух курсов языка, в том числе по умолчанию, — ошибка с обоими файлами", () => {
    for (const [it, travel] of [
      [{ palette: "ink" }, { palette: "ink" }],
      [{}, {}],
      [{ palette: "school" }, {}],
    ]) {
      const message = failure({ ...base(), ...englishCourse(it), ...travelCourse(travel) });
      expect(message).toContain("palette");
      expect(message).toContain("courses/english-it.yaml");
      expect(message).toContain("courses/english-travel.yaml");
    }
  });
  it("гамма по умолчанию у курсов разных языков проходит", () => {
    expect(() => build({ ...base(), ...englishCourse({}) })).not.toThrow();
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
  it("в тексте для чтения — по языку его курса: латиница в греческом слове и кириллица в английском — ошибка", () => {
    const reading = (text: string) => ({
      title: "Текст",
      after: "m01-1",
      text,
      provenance: { operation: "requested-generation", request: "Тест", review: "none" },
    });
    expect(failure({ ...base(), "readings/greek-a2/r-m01-x.yaml": reading("Γεια σoυ, Άννα.") })).toMatch(
      /readings\/greek-a2\/r-m01-x\.yaml.*смешаны алфавиты/,
    );
    const english = {
      ...base(),
      "courses/english-it.yaml": { title: "Английский", language: "en", palette: "ink", modules: ["e01"] },
      "modules/e01.yaml": { number: 1, title: "Work", subtitle: "Работа", status: "draft", goal: "Цель", sessions: 3 },
      "readings/english-it/r-e01-x.yaml": { ...reading("The bus іs late."), after: "e01-1" },
    };
    expect(failure(english)).toContain("смешаны алфавиты");
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
        "words/vocab/geia.yaml": { greek: "γεια", russian: "привет" },
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
  const fresh = {
    "m01-1/dialogue-1.mp3": { voice: "Aoede", hash: lineHash("Γεια σου! Πώς σε λένε;", "Aoede", EL) },
  };

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
  it("греческая «;» уходит в синтез вопросительным знаком, текст урока не меняется", () => {
    expect(spokenText("Πού είσαι; Καλά.", "el-GR")).toBe("Πού είσαι? Καλά.");
    expect(spokenText("Πού είσαι\u037e", "el-GR")).toBe("Πού είσαι?");
    expect(spokenText("Wait; then go.", "en-US")).toBe("Wait; then go.");
    expect(lineHash("Είσαι καλά;", "Aoede", EL)).toBe(lineHash("Είσαι καλά?", "Aoede", EL));
  });
  it("запись, сделанная до правки текста или смены голоса, не публикуется: реплика звучит синтезом", () => {
    const content = build(
      files({ "m01-1/dialogue-1.mp3": { voice: "Aoede", hash: lineHash("Старый текст", "Aoede", EL) } }),
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

describe("записи слов и фраз", () => {
  const voicesMap = {
    source: "Синтез речи Google Cloud TTS, голос Chirp 3 HD {voice}",
    language: "el-GR",
    prefix: "el-GR-Chirp3-HD-",
    pools: { female: ["Aoede", "Kore"], male: ["Charon", "Puck"] },
    narrator: "Kore",
    characters: { Άννα: { gender: "female", voice: "Aoede" }, Νίκος: { gender: "male", voice: "Charon" } },
  };
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const phrase = {
    id: "p1",
    text: "Μιλάτε αγγλικά;",
    translation: "Вы говорите по-английски?",
    provenance: { sourceLabel: "Лексикон курса", operation: "requested-generation", request: "тест" },
  };
  const files = (manifest: Record<string, { voice: string; hash: string }>, voices: unknown = voicesMap) => ({
    ...base(),
    "lessons/m01-1.yaml": { ...lesson, items: [...lesson.items, { kind: "phrase", id: "p1" }] },
    "words/greek-a2/geia.yaml": { greek: "γεια", russian: "привет", forms: "—", audio: "words/geia.mp3" },
    "phrases/greek-a2/p1.yaml": { ...phrase, audio: "phrases/p1.mp3" },
    "voices/el.yaml": voices,
    "audio/words/geia.mp3": new Uint8Array([1]),
    "audio/phrases/p1.mp3": new Uint8Array([2]),
    "audio/dialogues.json": json(manifest),
  });
  const fresh = {
    "words/geia.mp3": { voice: "Kore", hash: lineHash("γεια", "Kore", EL) },
    "phrases/p1.mp3": { voice: "Kore", hash: lineHash("Μιλάτε αγγλικά;", "Kore", EL) },
  };

  it("запись читает диктор: карточка получает медиа с подписью его голоса", () => {
    const content = build(files(fresh));
    const pack = parsePackage(JSON.parse(JSON.stringify(content.packages[0])));
    expect(pack.words.find((word) => word.id === "geia")!.audioAssetId).toBe("snd-geia");
    expect(pack.phrases.find((item) => item.id === "p1")!.audioAssetId).toBe("snd-p1");
    for (const id of ["snd-geia", "snd-p1"])
      expect(pack.media.find((item) => item.id === id)).toMatchObject({
        kind: "audio",
        source: "Синтез речи Google Cloud TTS, голос Chirp 3 HD Kore",
      });
    expect(content.cardVoicing).toMatchObject({ voiced: 2, stale: [] });
  });
  it("запись до правки текста или смены диктора не публикуется: карточка звучит синтезом", () => {
    const edited = build(
      files({ ...fresh, "phrases/p1.mp3": { voice: "Kore", hash: lineHash("Старый текст", "Kore", EL) } }),
    );
    expect(edited.packages[0].phrases.find((item) => item.id === "p1")).not.toHaveProperty("audioAssetId");
    expect(edited.packages[0].media.some((item) => item.id === "snd-p1")).toBe(false);
    expect(edited.cardVoicing).toMatchObject({ voiced: 1, stale: ["phrases/greek-a2/p1.yaml"] });
    const recast = build(files(fresh, { ...voicesMap, narrator: "Aoede" }));
    expect(recast.cardVoicing.stale).toEqual(["words/greek-a2/geia.yaml", "phrases/greek-a2/p1.yaml"]);
  });
  it("без диктора в карте голосов запись карточки отклоняет сборку", () => {
    expect(failure(files(fresh, { ...voicesMap, narrator: undefined }))).toMatch(/narrator в voices\/el\.yaml/);
  });
});

describe("записи ответов перевода и пропуска", () => {
  const voicesMap = {
    source: "Синтез речи Google Cloud TTS, голос Chirp 3 HD {voice}",
    language: "el-GR",
    prefix: "el-GR-Chirp3-HD-",
    pools: { female: ["Aoede", "Kore"], male: ["Charon", "Puck"] },
    narrator: "Kore",
    characters: { Άννα: { gender: "female", voice: "Aoede" }, Νίκος: { gender: "male", voice: "Charon" } },
  };
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const files = (manifest: Record<string, { voice: string; hash: string }>) => ({
    ...base(),
    "voices/el.yaml": voicesMap,
    "audio/answers/m01-1/dialogue-q-q1.mp3": new Uint8Array([1]),
    "audio/answers/m01-test/gaps-g1.mp3": new Uint8Array([2]),
    "audio/dialogues.json": json(manifest),
  });
  const fresh = {
    "answers/m01-1/dialogue-q-q1.mp3": { voice: "Kore", hash: lineHash("Νίκο", "Kore", EL) },
    "answers/m01-test/gaps-g1.mp3": { voice: "Kore", hash: lineHash("Εγώ είμαι η Άννα.", "Kore", EL) },
  };
  const packOf = (content: ReturnType<typeof build>, id: string) =>
    parsePackage(JSON.parse(JSON.stringify(content.packages.find((pack) => pack.id === id))));
  const itemOf = (pack: ReturnType<typeof parsePackage>, blockId: string) => {
    const block = pack.blocks!.find((candidate) => candidate.id === blockId)!;
    return block.type === "exercise" ? block.items[0] : undefined;
  };

  it("перевод звучит первой формой ответа, пропуск — предложением с ним; запись читает диктор", () => {
    const content = build(files(fresh));
    expect(itemOf(packOf(content, "m01-1"), "dialogue-q")!.audioAssetId).toBe("answer-m01-1-dialogue-q-q1");
    const test = packOf(content, "m01-test");
    expect(test.itemAudio).toEqual({ gaps: { g1: "answer-m01-test-gaps-g1" } });
    expect(itemOf(test, "gaps")!.audioAssetId).toBe("answer-m01-test-gaps-g1");
    expect(test.media.find((item) => item.id === "answer-m01-test-gaps-g1")).toMatchObject({
      kind: "audio",
      source: "Синтез речи Google Cloud TTS, голос Chirp 3 HD Kore",
    });
    expect(content.voicing.answers).toEqual({ voiced: 2, unvoiced: 0, stale: 0 });
  });
  it("запись до правки ответа не публикуется: ответ звучит синтезом", () => {
    const content = build(
      files({
        ...fresh,
        "answers/m01-test/gaps-g1.mp3": { voice: "Kore", hash: lineHash("Εγώ είσαι", "Kore", EL) },
      }),
    );
    expect(packOf(content, "m01-test").itemAudio).toBeUndefined();
    expect(content.voicing.answers).toEqual({ voiced: 1, unvoiced: 1, stale: 1 });
  });
  it("пакет с записью ответа чужого блока, пункта или медиа отклоняется", () => {
    const raw = JSON.parse(JSON.stringify(build(files(fresh)).packages.find((pack) => pack.id === "m01-test")));
    expect(() => parsePackage({ ...raw, itemAudio: { nope: { g1: "answer-m01-test-gaps-g1" } } })).toThrow(
      /задания с таким id нет/,
    );
    expect(() => parsePackage({ ...raw, itemAudio: { gaps: { g9: "answer-m01-test-gaps-g1" } } })).toThrow(
      /пункта с таким id нет/,
    );
    expect(() => parsePackage({ ...raw, itemAudio: { gaps: { g1: "нет-такого" } } })).toThrow(/нет в пакете/);
  });
  it("план озвучки: без записи или устаревшее — озвучить, файл без пункта — удалить", () => {
    const voices = {
      ...voicesMap,
      file: "voices/el.yaml",
      characters: new Map(),
      respell: new Map(),
      pools: voicesMap.pools,
    };
    const plan = planAnswerVoices(
      [["m01-test", test.blocks]],
      () => ({ voices, profile: PROFILES.el }),
      { "answers/m01-test/gone-q1.mp3": { voice: "Kore", hash: "x" } },
      ["answers/m01-test/gaps-g1.mp3", "answers/m01-test/gone-q1.mp3"],
    );
    expect(plan.pending.map((answer) => [answer.file, answer.text])).toEqual([
      ["answers/m01-test/gaps-g1.mp3", "Εγώ είμαι η Άννα."],
    ]);
    expect(plan.stale).toEqual(["answers/m01-test/gone-q1.mp3"]);
  });
});
