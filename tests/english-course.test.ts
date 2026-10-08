import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildContent } from "../content/build";
import { englishInflections } from "../content/marks";
import { ContentError, parseCatalog, parsePackage } from "../src/content/schema";

/** Фикстура английского курса: один опубликованный модуль из урока и контрольной. */
type Files = Record<string, unknown>;
const READING = "She goes to work by bus. Yesterday she went by train. She studies English and stopped smoking.";
const base = (): Files => ({
  "courses/english-b2.yaml": { title: "Английский B2", language: "en", modules: ["e01"] },
  "modules/e01.yaml": {
    number: 1,
    title: "Work",
    subtitle: "Работа",
    status: "published",
    goal: "Рассказать о работе",
    sessions: 2,
    lessons: ["e01-1", "e01-test"],
  },
  "lessons/e01-1.yaml": {
    title: "Дорога на работу",
    kind: "lesson",
    items: [
      { kind: "word", id: "go" },
      { kind: "word", id: "study" },
      { kind: "word", id: "stop" },
    ],
    blocks: [
      { type: "vocabulary", id: "words" },
      { type: "reading", id: "text", title: "Anna", text: READING },
      {
        type: "exercise",
        id: "text-tf",
        about: "text",
        instruction: "Верно или неверно?",
        format: "choice",
        items: [{ id: "q1", prompt: "She goes by car.", options: ["True", "False"], answer: "False" }],
      },
      {
        type: "listening",
        id: "dialogue",
        title: "At the office",
        transcript: [
          { speaker: "Anna", text: "Where do you go every morning?" },
          { speaker: "Tom", text: "I go to the office." },
        ],
      },
      {
        type: "exercise",
        id: "dialogue-q",
        about: "dialogue",
        instruction: "Ответьте",
        format: "text",
        items: [{ id: "q1", prompt: "Where does Tom go?", answer: "to the office" }],
      },
      {
        type: "writing",
        id: "about-me",
        register: "friendly",
        prompt: "Напишите 3 предложения о дороге на работу.",
        words: { min: 10, max: 30 },
        model: "I go to work by bus. I study on the way.",
        criteria: ["Транспорт", "Время"],
      },
      {
        type: "speaking",
        id: "intro",
        part: "interview",
        prompt: "Ответьте: How do you go to work?",
        seconds: 30,
        criteria: ["Полный ответ"],
      },
    ],
  },
  "lessons/e01-test.yaml": {
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
        bank: ["go", "goes", "went"],
        items: [{ id: "g1", prompt: "Yesterday I ___ home.", answer: "went" }],
      },
    ],
  },
  "words/english-b2/go.yaml": { greek: "to go", russian: "идти, ехать", forms: "went, gone" },
  "words/english-b2/study.yaml": { greek: "study", russian: "учиться" },
  "words/english-b2/stop.yaml": { greek: "stop", russian: "прекращать" },
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function build(files: Files) {
  const root = mkdtempSync(join(tmpdir(), "english-"));
  roots.push(root);
  for (const [path, value] of Object.entries(files)) {
    if (value === undefined) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), stringify(value));
  }
  return buildContent(root);
}
const failure = (files: Files) => {
  try {
    build(files);
  } catch (error) {
    expect(error).toBeInstanceOf(ContentError);
    return (error as Error).message;
  }
  throw new Error("сборка прошла, а должна была отказать");
};

describe("английский курс", () => {
  it("собирается с языком курса в каталоге и пакетах", () => {
    const content = build(base());
    const catalog = parseCatalog(
      JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string),
    );
    expect(catalog.courses[0]).toMatchObject({ id: "english-b2", language: "en" });
    expect(content.packages.map((p) => [p.id, p.language])).toEqual([
      ["e01-1", "en"],
      ["e01-test", "en"],
    ]);
  });
  it("в тексте находятся формы слов: окончания и неправильные формы из карточки", () => {
    const pack = parsePackage(JSON.parse(JSON.stringify(build(base()).packages[0])));
    const marks = pack.marks!;
    const found = marks.blocks.text.text.map(([start, length, ref]) => [
      READING.slice(start, start + length),
      marks.refs[ref],
    ]);
    expect(found).toEqual([
      ["goes", "w:go"],
      ["went", "w:go"],
      ["studies", "w:study"],
      ["stopped", "w:stop"],
    ]);
  });
  it("слово без латинских букв отклоняет сборку", () => {
    expect(failure({ ...base(), "words/english-b2/stop.yaml": { greek: "στοπ", russian: "прекращать" } })).toMatch(
      /words\/english-b2\/stop\.yaml: нет букв языка курса \(en\)/,
    );
  });
  it("латинская и греческая буква в одном слове — ошибка раскладки", () => {
    expect(failure({ ...base(), "words/english-b2/stop.yaml": { greek: "stοp", russian: "прекращать" } })).toContain(
      "смешаны алфавиты",
    );
  });
  it("язык без профиля отклоняет курс и называет язык", () => {
    const files = { ...base(), "courses/english-b2.yaml": { title: "Французский", language: "fr", modules: ["e01"] } };
    expect(failure(files)).toMatch(/courses\/english-b2\.yaml\.language: нет профиля языка «fr»/);
  });
  it("карта голосов другого языка в voices/en.yaml отклоняется", () => {
    const voices = {
      source: "Google Cloud TTS, голос {voice}",
      language: "el-GR",
      prefix: "el-GR-Chirp3-HD-",
      pools: { female: ["Aoede"], male: ["Charon"] },
      characters: { Anna: { gender: "female", voice: "Aoede" } },
    };
    expect(failure({ ...base(), "voices/en.yaml": voices })).toContain(
      "voices/en.yaml.language: el-GR — не язык файла (en)",
    );
  });
});

/** Рядом с английским — словарный греческий курс из одного урока: у каждого курса свои карточки. */
const withGreek = (lesson: Record<string, unknown> = { title: "Привет", items: [{ kind: "word", id: "geia" }] }) => ({
  ...base(),
  "courses/greek-a2.yaml": { title: "Греческий A2", lessons: ["g1"] },
  "lessons/g1.yaml": lesson,
  "words/greek-a2/geia.yaml": { greek: "γεια", russian: "привет" },
  "phrases/greek-a2/ti-kaneis.yaml": {
    text: "Τι κάνεις;",
    translation: "Как дела?",
    provenance: { sourceLabel: "Пример теста", operation: "requested-generation", request: "фраза для теста" },
  },
});

describe("карточки по курсам", () => {
  it("два курса собираются вместе, и пакет каждого несёт только свои карточки", () => {
    const content = build(
      withGreek({
        title: "Привет",
        items: [
          { kind: "word", id: "geia" },
          { kind: "phrase", id: "ti-kaneis" },
        ],
      }),
    );
    const catalog = parseCatalog(
      JSON.parse(content.files.find((f) => f.path === "content/catalog.json")!.body as string),
    );
    expect(catalog.courses.map((course) => [course.id, course.language])).toEqual([
      ["english-b2", "en"],
      ["greek-a2", "el"],
    ]);
    const cards = (id: string) => {
      const pack = content.packages.find((p) => p.id === id)!;
      return [...pack.words, ...pack.phrases].map((card) => card.id).sort();
    };
    expect(cards("e01-1")).toEqual(["go", "stop", "study"]);
    expect(cards("g1")).toEqual(["geia", "ti-kaneis"]);
  });
  it("файл прямо в words/ или phrases/ — карточка вне курса", () => {
    expect(failure({ ...base(), "words/loose.yaml": { greek: "loose", russian: "свободный" } })).toContain(
      "words/loose.yaml: карточка вне курса",
    );
    expect(failure({ ...withGreek(), "phrases/hello.yaml": { text: "Hello", provenance: {} } })).toContain(
      "phrases/hello.yaml: карточка вне курса",
    );
  });
  it("папка карточек называется курсом из courses/", () => {
    expect(failure({ ...base(), "words/english-c1/run.yaml": { greek: "run", russian: "бежать" } })).toContain(
      "курса english-c1 нет в courses/",
    );
  });
  it("повтор идентификатора в двух курсах называет оба файла", () => {
    const message = failure({ ...withGreek(), "words/greek-a2/go.yaml": { greek: "πάω", russian: "идти" } });
    expect(message).toContain("words/greek-a2/go.yaml");
    expect(message).toContain("words/english-b2/go.yaml");
    expect(message).toContain("«go»");
  });
  it("урок со словом другого курса отклоняется с карточкой и обоими курсами", () => {
    const items = withGreek({
      title: "Привет",
      items: [
        { kind: "word", id: "geia" },
        { kind: "word", id: "study" },
      ],
    });
    expect(failure(items)).toContain("карточка study из курса english-b2 в уроке курса greek-a2");
    const list = withGreek({ title: "Привет", words: ["geia", "go"] });
    expect(failure(list)).toContain("lessons/g1.yaml.words[1]: карточка go из курса english-b2 в уроке курса greek-a2");
  });
});

describe("английские окончания", () => {
  it("-s/-es, -ed, -ing с y → i, выпадением e и удвоением согласной", () => {
    expect(englishInflections("study")).toEqual(["studies", "studied", "studying"]);
    expect(englishInflections("stop")).toEqual(expect.arrayContaining(["stops", "stopped", "stopping"]));
    expect(englishInflections("make")).toEqual(["makes", "maked", "making"]);
    expect(englishInflections("watch")).toEqual(expect.arrayContaining(["watches", "watched", "watching"]));
    expect(englishInflections("go")).toEqual(expect.arrayContaining(["goes", "going"]));
  });
});
