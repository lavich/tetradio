import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildContent, readSources } from "../content/build";
import { ARTICLE_WORDS } from "../content/greek";
import { packLessons } from "../content/build/output";
import { lineHash } from "../content/build/voices";
import { ContentError } from "../src/content/schema";

type Files = Record<string, unknown>;
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const base = (): Files => ({
  "courses/greek-a2.yaml": { title: "Греческий", lessons: ["l1"] },
  "words/greek-a2/geia.yaml": { greek: "γεια", russian: "привет" },
  "lessons/l1.yaml": { title: "Привет", words: ["geia"] },
});
const write = (files: Files) => {
  const root = mkdtempSync(join(tmpdir(), "checks-"));
  roots.push(root);
  for (const [path, value] of Object.entries(files)) {
    if (value === undefined) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof value === "string" || value instanceof Uint8Array ? value : stringify(value),
    );
  }
  return root;
};
const failure = (files: Files) => {
  try {
    buildContent(write(files));
  } catch (error) {
    expect(error).toBeInstanceOf(ContentError);
    return (error as Error).message;
  }
  throw new Error("сборка прошла, а должна была отказать");
};

describe("исходники: разбор и форма", () => {
  it("текущая форма собирается", () => {
    expect(buildContent(write(base())).packages).toHaveLength(1);
  });
  it("битый YAML называет файл и строку", () => {
    const message = failure({ ...base(), "words/greek-a2/geia.yaml": 'greek: "γεια\nrussian: привет\n' });
    expect(message).toContain("words/greek-a2/geia.yaml:");
    expect(message).toMatch(/line \d/);
  });
  it("документ не карта и пустой файл", () => {
    expect(failure({ ...base(), "words/greek-a2/geia.yaml": "- а\n- б\n" })).toContain(
      "words/greek-a2/geia.yaml: ожидалась карта полей",
    );
    expect(failure({ ...base(), "lessons/l1.yaml": "" })).toContain("lessons/l1.yaml: ожидалась карта полей");
    expect(failure({ ...base(), "voices/el.yaml": "[]" })).toContain("voices/el.yaml: ожидалась карта полей");
    expect(failure({ ...base(), "voices/el.yaml": "a: [" })).toContain("voices/el.yaml:");
  });
  it("поле не того типа: путь и поле, а не TypeError", () => {
    const word = { greek: "γεια", russian: "привет" };
    expect(failure({ ...base(), "words/greek-a2/geia.yaml": { ...word, examples: 5 } })).toContain(
      "words/greek-a2/geia.yaml.examples: ожидался список",
    );
    expect(failure({ ...base(), "words/greek-a2/geia.yaml": { ...word, examples: [null] } })).toContain(
      "words/greek-a2/geia.yaml.examples[0]: ожидалась карта полей",
    );
    expect(failure({ ...base(), "lessons/l1.yaml": { title: "Привет", words: "geia" } })).toContain(
      "lessons/l1.yaml.words: ожидался список",
    );
    expect(failure({ ...base(), "courses/greek-a2.yaml": { title: "Греческий", lessons: "l1" } })).toContain(
      "courses/greek-a2.yaml.lessons: ожидался список",
    );
  });
  it("опечатка в имени поля отклоняет сборку", () => {
    expect(
      failure({ ...base(), "words/greek-a2/geia.yaml": { greek: "γεια", russian: "привет", froms: "γεια" } }),
    ).toBe("words/greek-a2/geia.yaml: лишнее поле froms");
    expect(failure({ ...base(), "lessons/l1.yaml": { title: "Привет", words: ["geia"], wrods: [] } })).toContain(
      "lessons/l1.yaml: лишнее поле wrods",
    );
    expect(
      failure({ ...base(), "courses/greek-a2.yaml": { title: "Греческий", lessons: ["l1"], lesson: [] } }),
    ).toContain("courses/greek-a2.yaml: лишнее поле lesson");
  });
  it("служебные имена не обходят проверку полей", () => {
    expect(failure({ ...base(), "lessons/l1.yaml": { title: "Привет", words: ["geia"], file: "x" } })).toContain(
      "лишнее поле file",
    );
    expect(failure({ ...base(), "lessons/l1.yaml": { title: "Привет", words: ["geia"], constructor: 1 } })).toContain(
      "лишнее поле constructor",
    );
  });
  it("статус и дата урока по-прежнему объяснены", () => {
    expect(failure({ ...base(), "lessons/l1.yaml": { title: "Привет", words: ["geia"], status: "done" } })).toContain(
      "принадлежат пользователю",
    );
  });
  it("урок в двух файлах называет оба", () => {
    const message = failure({ ...base(), "lessons/l1.yml": { title: "Копия", words: ["geia"] } });
    expect(message).toContain("lessons/l1.yml");
    expect(message).toContain("lessons/l1.yaml");
  });
  it("озвучка читает урок с непонятной структурой без отказа", () => {
    const root = write({ ...base(), "lessons/l1.yaml": { title: "Привет", words: ["geia"], blocks: "правка" } });
    expect(readSources(root).lessons.get("l1")).toBeDefined();
  });
});

describe("картинки библиотеки", () => {
  const picture = (svg: string): Files => ({
    ...base(),
    "pictures.yaml": { source: "Microsoft Fluent Emoji (Flat), MIT", words: { geia: "sun.svg" } },
    "pictures/sun.svg": new TextEncoder().encode(svg),
  });
  it("чистая картинка проходит", () => {
    expect(buildContent(write(picture('<svg viewBox="0 0 32 32"><path d="M0 0h1"/></svg>'))).packages).toHaveLength(1);
  });
  it.each([
    ['<svg><image href="https://x.test/a.png"/></svg>', "растровое или встроенное"],
    ['<svg onload="x()"><path d="M0 0"/></svg>', "обработчик события"],
    ['<svg><path fill="url(https://x.test/a)"/></svg>', "url\\(\\) не на элемент"],
    ["<svg><style>a{}</style></svg>", "стили"],
    ['<svg><use xlink:href="https://x.test/a.svg"/></svg>', "ссылка не на элемент"],
    ['<svg><use href = "https://x.test/a.svg"/></svg>', "ссылка не на элемент"],
    ["<svg><SCRIPT>x()</SCRIPT></svg>", "скрипт"],
    ['<svg><path style="fill:URL(https://x.test/a)"/></svg>', "url\\(\\) не на элемент"],
  ])("%s отклоняется", (svg, reason) => {
    expect(failure(picture(svg))).toMatch(new RegExp(`^pictures\\.yaml\\.words\\.geia: в sun\\.svg ${reason}`));
  });
  it("внутренняя ссылка на элемент файла допустима", () => {
    expect(
      buildContent(write(picture('<svg><clipPath id="a"/><path clip-path="url(#a)" d="M0 0"/></svg>'))).packages,
    ).toHaveLength(1);
  });
});

describe("сообщения и исходники при сборке", () => {
  it("текст после урока модуля-черновика называет причину", () => {
    const root = mkdtempSync(join(tmpdir(), "checks-"));
    roots.push(root);
    cpSync("tests/fixtures/course-demo", root, { recursive: true });
    const file = join(root, "readings/greek-a2/r-m01-anna.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("after: m01-1", "after: m02-1"));
    expect(() => buildContent(root)).toThrow(/урок m02-1 в модуле-черновике/);
    writeFileSync(file, readFileSync(file, "utf8").replace("after: m02-1", "after: нет-такого"));
    expect(() => buildContent(root)).toThrow(/урока нет-такого нет в курсе/);
  });
  it("пакет вне формата клиента отклоняется и без разметки и озвучки", () => {
    const pack = buildContent(write(base())).packages[0];
    const broken = { ...pack, words: "нет" } as unknown as typeof pack;
    expect(() => packLessons(new Map([[pack.id, broken]]), { packages: new Map() })).toThrow(
      new RegExp(`^lessons/${pack.id}.yaml:`),
    );
    expect(() => packLessons(new Map([[pack.id, pack]]), { packages: new Map() })).not.toThrow();
  });
  it("устаревшая запись слова снимается с карточки, а исходник сохраняет audio", () => {
    const voices = {
      source: "Синтез {voice}",
      language: "el-GR",
      prefix: "el-GR-Chirp3-HD-",
      pools: { female: ["Aoede"], male: ["Charon"] },
      narrator: "Aoede",
      characters: {},
    };
    const files = (hash: string): Files => ({
      ...base(),
      "words/greek-a2/geia.yaml": { greek: "γεια", russian: "привет", audio: "words/geia.mp3" },
      "voices/el.yaml": voices,
      "audio/words/geia.mp3": new Uint8Array([1]),
      "audio/dialogues.json": new TextEncoder().encode(JSON.stringify({ "words/geia.mp3": { voice: "Aoede", hash } })),
    });
    const fresh = buildContent(write(files(lineHash("γεια", "Aoede", "el-GR"))));
    expect(fresh.words[0].audioAssetId).toBe("snd-geia");
    const stale = buildContent(write(files("устарел")));
    expect(stale.cardVoicing.stale).toEqual(["words/greek-a2/geia.yaml"]);
    expect(stale.words[0]).not.toHaveProperty("audioAssetId");
    expect(stale.sources.words.get("geia")!.audio).toBe("words/geia.mp3");
  });
});

describe("артикли", () => {
  it("общий список — те же четырнадцать форм, что были в разметке и подсчёте", () => {
    expect(ARTICLE_WORDS).toEqual([
      "ο",
      "η",
      "το",
      "οι",
      "τα",
      "τον",
      "την",
      "τη",
      "του",
      "της",
      "των",
      "τους",
      "τις",
      "τ",
    ]);
  });
});
