import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildContent } from "../content/build";
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
  it("пакет схемы 3 не может нести блоки", () => {
    const pack = JSON.parse(JSON.stringify(build(base()).packages[0]));
    expect(() => parsePackage({ ...pack, schemaVersion: 3 })).toThrow("появились в схеме 4");
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
