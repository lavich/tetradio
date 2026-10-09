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
  "words/go.yaml": { greek: "to go", russian: "идти, ехать", forms: "went, gone" },
  "words/study.yaml": { greek: "study", russian: "учиться" },
  "words/stop.yaml": { greek: "stop", russian: "прекращать" },
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
    expect(failure({ ...base(), "words/stop.yaml": { greek: "στοπ", russian: "прекращать" } })).toMatch(
      /words\/stop\.yaml: нет букв языка курса \(en\)/,
    );
  });
  it("латинская и греческая буква в одном слове — ошибка раскладки", () => {
    expect(failure({ ...base(), "words/stop.yaml": { greek: "stοp", russian: "прекращать" } })).toContain(
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

describe("английские окончания", () => {
  it("-s/-es, -ed, -ing с y → i, выпадением e и удвоением согласной", () => {
    expect(englishInflections("study")).toEqual(["studies", "studied", "studying"]);
    expect(englishInflections("stop")).toEqual(expect.arrayContaining(["stops", "stopped", "stopping"]));
    expect(englishInflections("make")).toEqual(["makes", "maked", "making"]);
    expect(englishInflections("watch")).toEqual(expect.arrayContaining(["watches", "watched", "watching"]));
    expect(englishInflections("go")).toEqual(expect.arrayContaining(["goes", "going"]));
  });
});
