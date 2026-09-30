import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colorsOf, foreignColors, PALETTE, paletteColors, parseLegacy } from "../content/art";
import { buildContent, revisionOf, wordsOf } from "../content/build";
import { ContentError, parseCatalog, parsePackage, SCHEMA_VERSION } from "../src/content/schema";
import { wordKey } from "../src/domain/import";
import { stressNote } from "../src/domain/phonetics";
import { restoreWriting, tiles } from "../src/domain/syllables";

const md = readFileSync("tests/fixtures/tavelori/seed-lessons.md", "utf8");
const section = (title: string) => md.split(`## ${title}`)[1].split("\n## ")[0];
const rows = (title: string) =>
  section(title)
    .split("\n")
    .filter((line) => /^\| [^-]/.test(line) && !line.includes("Греческий"))
    .map((line) =>
      line
        .split("|")
        .slice(1, 3)
        .map((cell) => cell.trim()),
    );

const content = buildContent("tests/fixtures/tavelori-content");
const seedWords = content.words;
/** Подготовленные карточки: у них проверена фонетика, поэтому к ним предъявляются полные требования. */
const prepared = content.words.filter((word) => word.verified);
const packageOf = (id: string) => content.packages.find((p) => p.id === id)!;
const fileOf = (path: string) => content.files.find((file) => file.path === path)!;
const lessonSource = (id: string) => content.sources.lessons.get(id)!;
/** Слова урока по его объявлению: словарный урок перечисляет `words`, смешанный — `items`. */
const wordIdsOf = (id: string) => {
  const source = lessonSource(id);
  return source.items ? source.items.filter((item) => item.kind === "word").map((item) => item.id) : source.words!;
};
const seedArt = (id: string) =>
  Buffer.from(content.sources.files.get(`art/${content.sources.words.get(id)!.image}`)!).toString("utf8");

/** Копия исходников, в которой можно сломать один файл и проверить отказ публикации. */
function brokenCopy(mutate: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "tetradio-content-"));
  // Копируются все папки контента: новый вид карточек не должен ломать фикстуру.
  for (const entry of readdirSync("tests/fixtures/tavelori-content", { withFileTypes: true }))
    if (entry.isDirectory())
      cpSync(join("tests/fixtures/tavelori-content", entry.name), join(root, entry.name), { recursive: true });
  mutate(root);
  try {
    return buildContent(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("исходные наборы 1.1 и 1.2 сохранены в начале уроков", () => {
  /** Архивный набор не переставляется и не редактируется: дописанные позже слова идут после него. */
  it.each([
    ["Урок 1.1", "lesson-1-1", 33],
    ["Урок 1.2", "lesson-1-2", 30],
  ] as const)("%s", (title, lessonId, count) => {
    const expected = rows(title);
    const words = wordsOf(content, lessonId);
    expect(expected).toHaveLength(count);
    expect(words.slice(0, count).map((w) => [w.greek, w.russian])).toEqual(expected);
  });
  it("урок 1.1 дополнен пятью служебными словами после исходного набора", () => {
    expect(
      wordsOf(content, "lesson-1-1")
        .slice(33, 38)
        .map((w) => [w.greek, w.russian]),
    ).toEqual([
      ["Σωστό", "верно"],
      ["Λάθος", "неверно"],
      ["και", "и"],
      ["ένα", "один"],
      ["στο", "в"],
    ]);
  });
  /** Материал занятия — приветствия, слова текстов и примеры правил чтения — вынесен в отдельный урок. */
  it("слова занятия живут в дополнительном словаре, а состав 1.1 остаётся прежним", () => {
    const number = (id: string) => Number(id.slice(4));
    expect(wordsOf(content, "lesson-1-1").every((word) => /^w11-\d\d$/.test(word.id) && number(word.id) <= 38)).toBe(
      true,
    );
    const extra = wordsOf(content, "lesson-1-1-extra");
    // Идентификаторы при переносе не менялись: прогресс остаётся у тех же карточек.
    expect(extra.every((word) => /^w11-\d\d$/.test(word.id) && number(word.id) >= 39)).toBe(true);
    expect(extra.map((word) => word.greek).slice(0, 5)).toEqual([
      "Γεια",
      "Καλημέρα",
      "Καλησπέρα",
      "Χαίρετε",
      "Ευχαριστώ",
    ]);
  });
  /** Порядок занятий даёт номер в заголовке: заголовок без номера ставит урок после всех нумерованных. */
  it("дополнительный словарь не встраивается между нумерованными уроками", () => {
    const title = packageOf("lesson-1-1-extra").lesson.title;
    expect(title).toBe("Дополнительный словарь");
    expect(/\d/.test(title)).toBe(false);
  });
  /** Пакет описывает урок, а не занятие: статус и дата принадлежат пользователю и в поставку не попадают. */
  it("пакет несёт только название урока", () => {
    expect(packageOf("lesson-1-1").lesson).toEqual({ title: "Урок 1.1" });
    expect(packageOf("lesson-1-2").lesson).toEqual({ title: "Урок 1.2" });
    for (const [id, source] of content.sources.lessons)
      expect(Object.keys(source), id).toEqual(expect.not.arrayContaining(["status", "targetDate"]));
  });
});

describe("наборы класса переносятся без потерь и без дублей", () => {
  it.each(["lesson-1-3", "lesson-1-4"] as const)("%s", (lessonId) => {
    const declared = wordIdsOf(lessonId);
    expect(declared.length).toBeGreaterThan(0);
    expect(packageOf(lessonId).links).toHaveLength(declared.length);
    expect(wordsOf(content, lessonId).map((word) => word.id)).toEqual(declared);
  });

  it("повторяющееся слово остаётся одной записью с общим идентификатором во всех пакетах", () => {
    const linked = new Set(content.packages.flatMap((pack) => pack.words.map((word) => word.id)));
    expect(seedWords).toHaveLength(linked.size);
    expect(new Set(seedWords.map((word) => wordKey(word.greek, word.russian))).size).toBe(seedWords.length);
    expect(new Set(seedWords.map((word) => word.id)).size).toBe(seedWords.length);
    // «το σπίτι» пришло и в 1.2, и в 1.3 — в обоих пакетах одна и та же запись
    const house = seedWords.filter((word) => word.greek === "το σπίτι");
    expect(house).toHaveLength(1);
    const inThird = packageOf("lesson-1-3").words.find((word) => word.id === house[0].id);
    expect(inThird).toEqual(house[0]);
    expect(packageOf("lesson-1-3").media.some((item) => item.id === house[0].imageAssetId)).toBe(true);
  });

  it("каждое слово годится для упражнений: перевод, восстановимое написание и стабильный id", () => {
    for (const word of seedWords) {
      expect(word.greek.trim(), word.id).toMatch(/[Ͱ-Ͽἀ-῿]/u);
      expect(word.russian.trim().length, word.greek).toBeGreaterThan(0);
      expect(restoreWriting(word.greek, tiles(word.greek)), word.greek).toBe(word.greek.normalize("NFC").trim());
      expect(word.id).toMatch(/^w\d{2}-\d{2}$/);
    }
    expect(seedWords.filter((word) => tiles(word.greek).length < 2).map((word) => word.greek)).toEqual([
      "Γεια",
      "γκρι",
      "η Γη",
      "η σκιά",
      "και",
      "μπλε",
      "ο γιος",
      "πού",
      "Ροζ",
      "στο",
      "το φως",
    ]);
  });

  it("множественное число живёт в заметке, а не в самом слове", () => {
    const year = seedWords.find((word) => word.russian === "год")!;
    expect(year.greek).toBe("ο χρόνος");
    expect(year.note).toContain("τα χρόνια");
    expect(tiles(year.greek)).toEqual(["χρό", "νος"]);
  });
  /** Полумеры недопустимы: карточка либо готова к занятию целиком, либо честно помечена непроверенной. */
  it("карточка подготовлена целиком или не претендует на подготовленность", () => {
    for (const word of seedWords) {
      if (word.verified) {
        expect(word.ipa, word.greek).toMatch(/^\/.+\/$/);
        expect(word.examples.length, word.greek).toBeGreaterThan(0);
        expect(word.imageAssetId, word.greek).toBe(`img-${word.id}`);
      } else {
        expect(word.ipa, word.greek).toBe("");
        expect(word.examples, word.greek).toEqual([]);
        expect(word.imageAssetId, word.greek).toBeUndefined();
      }
    }
  });
});

describe("уроки принадлежат курсам", () => {
  it("каталог отдаёт состав курса, а урок и пакет знают свой курс", () => {
    const leeke = content.catalog.courses.find((course) => course.id === "leeke")!;
    expect(leeke.title).toBe("Греческий A2");
    // Порядок состава задаёт файл курса, порядок пакетов — обход каталога уроков: совпадать они не обязаны.
    expect([...leeke.lessonIds].sort()).toEqual(content.packages.map((pack) => pack.id).sort());
    expect(leeke.lessonIds).toEqual(
      readFileSync("tests/fixtures/tavelori-content/courses/leeke.yaml", "utf8")
        .split("\n")
        .flatMap((line) => /^\s+- (\S+)$/.exec(line)?.[1] ?? []),
    );
    for (const entry of content.catalog.lessons) expect(entry.courseId, entry.id).toBe("leeke");
    for (const pack of content.packages) expect(pack.courseId, pack.id).toBe("leeke");
  });
  it("публикация требует, чтобы урок входил ровно в один курс", () => {
    const leeke = readFileSync("tests/fixtures/tavelori-content/courses/leeke.yaml", "utf8");
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "courses", "leeke.yaml"), leeke.replace("  - lesson-2-2\n", ""))),
    ).toThrow(/lessons\/lesson-2-2.yaml: урок не входит ни в один курс/);
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(join(root, "courses", "другой.yaml"), "title: Другой курс\nlessons:\n  - lesson-2-2\n"),
      ),
    ).toThrow(/courses\/другой.yaml: урок lesson-2-2 уже входит в курс leeke/);
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "courses", "leeke.yaml"), leeke + "  - lesson-9-9\n")),
    ).toThrow(/courses\/leeke.yaml: урока lesson-9-9 нет/);
  });
  it("курс несёт язык и требует один язык на все свои уроки", () => {
    expect(content.catalog.courses.find((course) => course.id === "leeke")!.language).toBe("el");
    const lesson = readFileSync("tests/fixtures/tavelori-content/lessons/lesson-2-2.yaml", "utf8");
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(join(root, "lessons", "lesson-2-2.yaml"), lesson.replace("language: el", "language: en")),
      ),
    ).toThrow(/courses\/leeke.yaml: уроки курса на разных языках/);
  });
  it("каталог и пакет прежней версии без курса читаются как раньше", () => {
    const catalog = JSON.parse(fileOf("content/catalog.json").body as string);
    const { courses: _, ...flat } = catalog;
    expect(
      parseCatalog({
        ...flat,
        lessons: catalog.lessons.map(({ courseId: _id, ...rest }: Record<string, unknown>) => rest),
      }).courses,
    ).toEqual([]);
    const pack = JSON.parse(fileOf(content.catalog.lessons[0].url).body as string);
    const { courseId: _c, ...older } = pack;
    expect(parsePackage(older).courseId).toBe("");
  });
});

describe("каталог и пакеты", () => {
  it("каталог содержит только метаданные, без слов и медиа", () => {
    const catalog = parseCatalog(JSON.parse(fileOf("content/catalog.json").body as string));
    expect(catalog.lessons.map((l) => [l.id, l.wordCount, l.media.count])).toEqual(
      content.packages.map((pack) => [pack.id, pack.words.length, pack.media.length]),
    );
    const text = fileOf("content/catalog.json").body as string;
    expect(text).not.toContain("σπίτι");
    expect(text).not.toContain("<svg");
    // Метаданные урока — сотни символов, а не его содержимое; индекс слов — только идентификаторы, по ~10 символов на слово.
    const meta = JSON.stringify({ ...catalog, lessons: catalog.lessons.map(({ wordIds: _w, ...rest }) => rest) });
    expect(meta.length).toBeLessThan(catalog.lessons.length * 400);
    const ids = catalog.lessons.flatMap((l) => l.wordIds ?? []);
    expect(text.length - meta.length).toBeLessThan(ids.length * 16);
    for (const entry of catalog.lessons) {
      expect(entry.url).toBe(`content/packages/${entry.id}@${entry.version}.json`);
      expect(entry.bytes).toBe(Buffer.byteLength(fileOf(entry.url).body as string));
      expect(entry.language).toBe("el");
    }
  });
  it("каждый пакет проходит собственную проверку и ссылается на существующие медиа", () => {
    for (const entry of content.catalog.lessons) {
      const pack = parsePackage(JSON.parse(fileOf(entry.url).body as string));
      expect(pack.id).toBe(entry.id);
      expect(pack.version).toBe(entry.version);
      expect(pack.links.map((l) => l.position)).toEqual(pack.links.map((_, i) => i));
      for (const item of pack.media) {
        expect(item.url).toBe(`content/media/${item.id}@${item.version}.svg`);
        expect(Buffer.from(fileOf(item.url).body).toString("utf8")).toMatch(/^<svg xmlns/);
        expect(item.required).toBe(true);
      }
    }
  });
  it("версия пакета и ревизия слова меняются вместе с содержимым", () => {
    const word = seedWords[0];
    expect(word.revision).toBe(revisionOf(word));
    expect(revisionOf({ ...word, russian: "другой перевод" })).not.toBe(word.revision);
    expect(revisionOf({ ...word, segments: [...word.segments] })).toBe(word.revision);
    expect([...content.sources.lessons.keys()]).toEqual(content.packages.map((p) => p.id));
  });
  it("публикация отклоняет дубликаты слов, битые ссылки уроков, сирот и подписи в картинках", () => {
    const house = readFileSync("tests/fixtures/tavelori-content/words/το-σπίτι.yaml", "utf8");
    expect(() =>
      brokenCopy((root) => {
        writeFileSync(join(root, "words", "дубль.yaml"), house.replace("id: w12-16", "id: w99-01"));
        writeFileSync(
          join(root, "lessons", "lesson-1-2.yaml"),
          readFileSync("tests/fixtures/tavelori-content/lessons/lesson-1-2.yaml", "utf8").replace(
            "- w12-16",
            "- w99-01",
          ),
        );
      }),
    ).toThrow(/повторяет слово «το σπίτι — дом»/);
    expect(() => brokenCopy((root) => writeFileSync(join(root, "words", "дубль.yaml"), house))).toThrow(
      /идентификатор «w12-16» уже занят/,
    );
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(
          join(root, "lessons", "lesson-1-2.yaml"),
          readFileSync("tests/fixtures/tavelori-content/lessons/lesson-1-2.yaml", "utf8").replace(
            "- w12-16",
            "- w12-99",
          ),
        ),
      ),
    ).toThrow(/слова w12-99 нет/);
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "words", "το-τεστ.yaml"), "greek: το τεστ\nrussian: тест\n")),
    ).toThrow(/не входит ни в один урок/);
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(
          join(root, "art", "το-σπίτι.svg"),
          '<svg xmlns="http://www.w3.org/2000/svg"><text>дом</text></svg>',
        ),
      ),
    ).toThrow(/выдаёт ответ/);
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(join(root, "words", "το-σπίτι.yaml"), house.replace("image: το-σπίτι.svg", "image: нет.svg")),
      ),
    ).toThrow(/файла art\/нет.svg нет/);
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(join(root, "words", "το-σπίτι.yaml"), house.replace("target: σπίτι", "target: σπιτάκι")),
      ),
    ).toThrow(/не встречается в предложении/);
  });
  it("новое слово без поля id получает идентификатор из имени файла", () => {
    const built = brokenCopy((root) => {
      writeFileSync(join(root, "words", "το-δοκίμιο.yaml"), "greek: το δοκίμιο\nrussian: очерк\n");
      writeFileSync(
        join(root, "lessons", "lesson-1-4.yaml"),
        readFileSync("tests/fixtures/tavelori-content/lessons/lesson-1-4.yaml", "utf8") + "  - το-δοκίμιο\n",
      );
    });
    expect(built.words.find((word) => word.id === "το-δοκίμιο")).toMatchObject({
      greek: "το δοκίμιο",
      russian: "очерк",
    });
    expect(built.packages.find((p) => p.id === "lesson-1-4")!.links.at(-1)!.wordId).toBe("το-δοκίμιο");
  });
  it("повреждённый, неполный и несовместимый пакет отклоняются понятной ошибкой", () => {
    const pack = JSON.parse(fileOf(content.catalog.lessons[0].url).body as string);
    expect(() => parsePackage({ ...pack, schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/не поддерживается/);
    try {
      parsePackage({ ...pack, schemaVersion: 99 });
    } catch (error) {
      expect((error as ContentError).kind).toBe("unsupported");
    }
    expect(() => parsePackage({ ...pack, items: [...pack.items, { kind: "word", id: "нет", position: 99 }] })).toThrow(
      /которой нет в пакете/,
    );
    expect(() => parsePackage({ ...pack, words: [...pack.words, pack.words[0]] })).toThrow(/повторяются/);
    expect(() => parsePackage({ ...pack, media: [{ ...pack.media[0], url: "https://evil.example/x.svg" }] })).toThrow(
      /относительной/,
    );
    expect(() =>
      parsePackage({ ...pack, words: pack.words.map((w: { greek: string }) => ({ ...w, greek: "" })) }),
    ).toThrow(/нет написания/);
    expect(() => parsePackage("строка")).toThrow(/ожидался объект/);
    expect(() => parseCatalog({ schemaVersion: SCHEMA_VERSION, generatedAt: "x", lessons: [{ id: "a" }] })).toThrow(
      /ожидалась строка/,
    );
    expect(() => parseCatalog({ schemaVersion: 1, generatedAt: "x", lessons: [] })).toThrow(
      /версии схемы 1 не поддерживается/,
    );
  });
});

describe("индекс слов в каталоге", () => {
  it("запись урока перечисляет слова пакета в порядке состава, версия схемы прежняя", () => {
    expect(content.catalog.schemaVersion).toBe(4);
    for (const entry of content.catalog.lessons)
      expect(entry.wordIds).toEqual(packageOf(entry.id).words.map((word) => word.id));
    const raw = JSON.parse(fileOf("content/catalog.json").body as string);
    expect(raw.schemaVersion).toBe(4);
    expect(raw.lessons[0].wordIds).toEqual(content.catalog.lessons[0].wordIds);
  });
});

describe("карточка каждого подготовленного слова готова", () => {
  it("у каждого подготовленного слова есть IPA с ударением и распознанный ударный слог", () => {
    expect(prepared.length).toBeGreaterThan(0);
    for (const word of prepared) {
      expect(word.ipa, word.greek).toMatch(/^\/.+\/$/);
      const core = word.greek.replace(/^(ο|η|το|τα|οι) /, "");
      if (core.split(/\s+/).length === 1 && core.length > 3) expect(stressNote(word.greek), word.greek).not.toBeNull();
    }
  });
  it("диапазоны разбора чтения указывают на реальные буквы слова", () => {
    for (const word of prepared)
      for (const segment of word.segments) {
        expect(
          word.greek.slice(segment.start, segment.start + segment.text.length),
          `${word.greek}/${segment.text}`,
        ).toBe(segment.text);
        expect(segment.explanation.length).toBeGreaterThan(8);
        expect(segment.ipa).not.toMatch(/[а-яА-Я]/);
      }
  });
  it("ни одна пометка чтения не указывает на артикль молча", () => {
    for (const word of prepared)
      for (const segment of word.segments) {
        const article = word.greek.match(/^(ο|η|το|τα|οι)\s/)?.[1];
        if (article && segment.start < article.length)
          expect(segment.explanation, `${word.greek}: пометка попала в артикль`).toMatch(/артикл/i);
      }
  });
  it("пример содержит выделяемую форму слова и русский перевод", () => {
    for (const word of prepared) {
      const [example] = word.examples;
      expect(example.greek, word.greek).toMatch(/[Ͱ-Ͽἀ-῿]/u);
      expect(example.greek.includes(example.target), `${word.greek}: ${example.greek}`).toBe(true);
      expect(example.russian, word.greek).toMatch(/[а-яА-ЯёЁ]/);
      expect(example.source).toBeTruthy();
    }
  });
  it("у каждого слова есть своя иллюстрация без текста", () => {
    const seen = new Set<string>();
    for (const word of prepared) {
      const art = seedArt(word.id);
      expect(art, word.greek).toBeTruthy();
      expect(art).toMatch(/^<svg xmlns/);
      expect(art, `${word.greek}: подпись в картинке выдаёт ответ`).not.toMatch(/<text/);
      expect(seen.has(art), `${word.greek}: картинка повторяет другую`).toBe(false);
      seen.add(art);
      expect(word.imageAssetId).toBe(`img-${word.id}`);
    }
  });
  /** Лист — рабочий инструмент миграции: легенда палитры сверху, файлы вне палитры выделены рамкой с перечнем чужих цветов. */
  it("собирает лист для визуальной проверки с легендой палитры и подсветкой файлов вне палитры", () => {
    const legend = [...Object.entries(PALETTE.backgrounds), ...Object.entries(PALETTE.colors)]
      .map(([name, hex]) => `<span class="c"><i style="background:${hex}"></i>${name} ${hex}</span>`)
      .join("");
    const cards = prepared
      .map((w) => {
        const art = seedArt(w.id),
          foreign = foreignColors(art);
        return `<figure${foreign.length ? ' class="legacy"' : ""}><div class="a">${art}</div><figcaption>${w.greek} — ${w.russian}${foreign.length ? `<small>${foreign.join(" ")}</small>` : ""}</figcaption></figure>`;
      })
      .join("");
    mkdirSync("docs", { recursive: true });
    writeFileSync(
      "docs/art-sheet.html",
      `<!doctype html><meta charset="utf-8"><title>Иллюстрации Τετράδιο</title><style>body{font:14px system-ui;background:#f7f7f5;margin:0;padding:16px;display:grid;grid-template-columns:repeat(5,1fr);gap:12px}header{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px 14px;font-size:12px}.c i{display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:4px;border:1px solid #0002}figure{margin:0;background:#fff;border-radius:12px;overflow:hidden}figure.legacy{outline:2px solid #ef4444}.a svg{display:block;width:100%}figcaption{padding:6px 8px;color:#171717}figcaption small{display:block;color:#ef4444;font-family:monospace}</style><header>${legend}</header>${cards}`,
    );
    expect(cards).toContain("<figure");
  });
});

/** Стандарт иллюстраций (docs/art-standard.md): палитра — данные, проверки — в публикации, старые файлы — в legacy.txt. */
describe("иллюстрации подчиняются стандарту", () => {
  const legacyText = readFileSync("tests/fixtures/tavelori-content/art/legacy.txt", "utf8");
  const legacy = parseLegacy(legacyText);
  const house = readFileSync("tests/fixtures/tavelori-content/words/το-σπίτι.yaml", "utf8");
  const svg = (inner: string, attrs = 'viewBox="0 0 320 220"') =>
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="320" height="220" fill="#e7eefb"/>${inner}</svg>`;
  /** Копия, в которой το-σπίτι.svg перерисован заново и больше не числится унаследованным. */
  const redrawn = (art: string) =>
    brokenCopy((root) => {
      writeFileSync(join(root, "art", "το-σπίτι.svg"), art);
      writeFileSync(join(root, "art", "legacy.txt"), legacyText.replace("το-σπίτι.svg\n", ""));
    });
  it("палитра — единственный источник: документ перечисляет те же цвета", () => {
    const doc = readFileSync("docs/art-standard.md", "utf8");
    const section = doc.split("\n## Палитра")[1].split("\n## ")[0];
    expect(new Set(section.match(/#[0-9a-f]{6}/g))).toEqual(paletteColors());
    expect(paletteColors().size).toBeGreaterThanOrEqual(12);
    expect(paletteColors().size).toBeLessThanOrEqual(20);
    for (const hex of paletteColors()) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("цвета читаются из атрибутов и style, запись нормализуется", () => {
    expect(
      colorsOf(
        '<path fill="#FFF" stroke=\'#2563EB\' style="stop-color: #e7eefb; fill:none"/><stop stop-color="currentColor"/>',
      ),
    ).toEqual(new Set(["#ffffff", "#2563eb", "#e7eefb", "none", "currentcolor"]));
    expect(foreignColors('<path fill="none" stroke="#2563eb" opacity="0.5" style="fill:#abcdef"/>')).toEqual([
      "#abcdef",
    ]);
    expect(foreignColors('<path fill="#2563eb80"/>')).toEqual(["#2563eb80"]);
  });
  it("иллюстрация на каждое подготовленное слово, вне палитры — ровно список legacy.txt", () => {
    expect(content.art).toEqual({ files: prepared.length, legacy: legacy.size });
    for (const word of prepared) {
      const file = content.sources.words.get(word.id)!.image!;
      expect(legacy.has(file), file).toBe(foreignColors(seedArt(word.id)).length > 0);
    }
    // Список только сокращается: новую картинку в него не добавить, не подняв этот потолок в ревью.
    expect(legacy.size).toBeLessThanOrEqual(187);
  });
  it("новая картинка в палитре публикуется, служебные значения и прозрачность допустимы", () => {
    const built = redrawn(
      svg(
        '<path d="M10 10h20" fill="none" stroke="currentColor"/><circle cx="160" cy="110" r="40" fill="#2563EB" opacity="0.5"/><rect x="1" y="1" width="9" height="9" style="fill:#fbbf24;stroke:#1f2937"/>',
      ),
    );
    expect(built.art).toEqual({ files: prepared.length, legacy: legacy.size - 1 });
  });
  it("отклоняет размер, холст, текст, заголовок, скрипт, стиль, анимацию, растр и внешние ссылки", () => {
    expect(() => redrawn(svg(`<path d="M${"0 ".repeat(1500)}"/>`))).toThrow(/потолок иллюстрации — 3072 байта/);
    expect(() => redrawn(svg('<circle r="9"/>', 'viewBox="0 0 320 240"'))).toThrow(
      /холст viewBox="0 0 320 240", стандарт — viewBox="0 0 320 220"/,
    );
    expect(() => redrawn(svg('<circle r="9"/>', 'width="320"'))).toThrow(/холст viewBox=""/);
    expect(() => redrawn(svg("<text>дом</text>"))).toThrow(/выдаёт ответ/);
    expect(() => redrawn(svg("<title>дом</title>"))).toThrow(/заголовок или описание/);
    expect(() => redrawn(svg("<script>alert(1)</script>"))).toThrow(/скрипт/);
    expect(() => redrawn(svg('<circle r="9" onclick="x()"/>'))).toThrow(/обработчик события/);
    expect(() => redrawn(svg("<style>@keyframes a{}</style>"))).toThrow(/стили/);
    expect(() => redrawn(svg('<circle r="9"><animate attributeName="r" to="20"/></circle>'))).toThrow(/анимация/);
    expect(() => redrawn(svg('<image href="#x"/>'))).toThrow(/растровое/);
    expect(() => redrawn(svg('<use href="https://evil.example/x.svg#a"/>'))).toThrow(
      /ссылка не на элемент этого файла/,
    );
    expect(() => redrawn(svg('<rect fill="url(https://evil.example/p.png)"/>'))).toThrow(/url\(\) не на элемент/);
    expect(() => redrawn(svg('<rect fill="url(data:image/png;base64,AAAA)"/>'))).toThrow(/встроенные данные/);
    // Ссылки внутри файла разрешены
    expect(
      redrawn(
        svg(
          '<defs><linearGradient id="g"><stop stop-color="#fbbf24"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="9" height="9" fill="url(#g)"/><use href="#g"/>',
        ),
      ).art.legacy,
    ).toBe(legacy.size - 1);
  });
  it("цвет вне палитры: новая картинка отклоняется, унаследованная публикуется, список только сокращается", () => {
    expect(() => redrawn(svg('<circle r="9" fill="#fde68a" stroke="#ABCDEF"/>'))).toThrow(
      /art\/το-σπίτι.svg: цвета вне палитры #abcdef, #fde68a/,
    );
    // Тот же файл в legacy.txt — публикуется и учтён в отчёте
    expect(
      brokenCopy((root) => writeFileSync(join(root, "art", "το-σπίτι.svg"), svg('<circle r="9" fill="#fde68a"/>'))).art,
    ).toEqual({ files: prepared.length, legacy: legacy.size });
    // Унаследованный файл, который уже в палитре, просят убрать из списка
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "art", "το-σπίτι.svg"), svg('<circle r="9" fill="#2563eb"/>'))),
    ).toThrow(/уже в палитре — уберите его из art\/legacy.txt/);
    // Имя без файла — мусор в списке
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "art", "legacy.txt"), legacyText + "нет.svg\n")),
    ).toThrow(/файла art\/нет.svg нет — уберите имя из списка/);
    // Остальные проверки действуют и для унаследованных файлов
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "art", "το-σπίτι.svg"), svg("<text>дом</text>"))),
    ).toThrow(/выдаёт ответ/);
    // Новое слово со своей картинкой вне палитры не спрятать: его нет в списке
    expect(() =>
      brokenCopy((root) => {
        writeFileSync(join(root, "art", "το-δοκίμιο.svg"), svg('<circle r="9" fill="#123456"/>'));
        writeFileSync(
          join(root, "words", "το-δοκίμιο.yaml"),
          "greek: το δοκίμιο\nrussian: очерк\nimage: το-δοκίμιο.svg\n",
        );
        writeFileSync(
          join(root, "lessons", "lesson-1-4.yaml"),
          readFileSync("tests/fixtures/tavelori-content/lessons/lesson-1-4.yaml", "utf8") + "  - το-δοκίμιο\n",
        );
      }),
    ).toThrow(/art\/το-δοκίμιο.svg: цвета вне палитры #123456/);
    expect(house).toContain("image: το-σπίτι.svg");
  });
});

/** Разметка слов примера (add-example-word-glosses): отрезки находятся сборкой, ссылки проверяются по каталогу. */
describe("разметка слов примера", () => {
  const house = readFileSync("tests/fixtures/tavelori-content/words/το-σπίτι.yaml", "utf8");
  const withWords = (words: string) => (root: string) =>
    writeFileSync(join(root, "words", "το-σπίτι.yaml"), `${house.trimEnd()}\n    words:\n${words}`);
  const pilot = [
    '      - { text: "Το", russian: "артикль ср. р." }',
    '      - { text: "σπίτι", russian: "дом", word: w12-16 }',
    '      - { text: "μας", russian: "наш" }',
    '      - { text: "είναι", russian: "есть" }',
    '      - { text: "μεγάλο", russian: "большой", word: w13-20 }',
  ].join("\n");
  const houseOf = (built: ReturnType<typeof buildContent>) => built.words.find((word) => word.id === "w12-16")!;

  it("отрезки получают смещения в предложении, ссылки и перевод", () => {
    const example = houseOf(brokenCopy(withWords(pilot))).examples[0];
    expect(example.glosses).toEqual([
      { start: 0, length: 2, russian: "артикль ср. р." },
      { start: 3, length: 5, russian: "дом", wordId: "w12-16" },
      { start: 9, length: 3, russian: "наш" },
      { start: 13, length: 5, russian: "есть" },
      { start: 19, length: 6, russian: "большой", wordId: "w13-20" },
    ]);
    expect(example.glosses!.map((g) => example.greek.slice(g.start, g.start + g.length))).toEqual([
      "Το",
      "σπίτι",
      "μας",
      "είναι",
      "μεγάλο",
    ]);
  });
  it("повтор слова размечает следующее вхождение", () => {
    const built = brokenCopy((root) =>
      writeFileSync(
        join(root, "words", "το-σπίτι.yaml"),
        house.replace("Το σπίτι μας είναι μεγάλο.", "Το σπίτι και το σπίτι.") +
          '    words:\n      - { text: "σπίτι", russian: "дом" }\n      - { text: "σπίτι", russian: "дом" }\n',
      ),
    );
    expect(houseOf(built).examples[0].glosses!.map((g) => g.start)).toEqual([3, 16]);
  });
  it("сборка отклоняет отсутствующий отрезок, обратный порядок, пустой перевод и неизвестную ссылку", () => {
    expect(() => brokenCopy(withWords('      - { text: "σπίτια", russian: "дома" }'))).toThrow(
      /words\/το-σπίτι.yaml.examples\[0\].words\[0\]: отрезок «σπίτια» не найден/,
    );
    expect(() =>
      brokenCopy(withWords('      - { text: "μας", russian: "наш" }\n      - { text: "σπίτι", russian: "дом" }')),
    ).toThrow(/words\[1\]: отрезок «σπίτι» пересекается с предыдущим или стоит не по порядку/);
    expect(() => brokenCopy(withWords('      - { text: "μας", russian: " " }'))).toThrow(
      /words\[0\]: у отрезка «μας» нет перевода/,
    );
    expect(() => brokenCopy(withWords('      - { text: "μας", russian: "наш", word: w99-99 }'))).toThrow(
      /words\[0\]: отрезок «μας» ссылается на слово w99-99, которого нет в каталоге/,
    );
  });
  it("ссылка на слово другого урока принимается", () => {
    // «το σπίτι» есть в уроке 1.2, а «μεγάλος» в него не входит: ссылка проходит между уроками.
    const lesson = brokenCopy(withWords(pilot)).packages.find((p) => p.id === "lesson-1-2")!;
    expect(lesson.words.some((w) => w.id === "w13-20")).toBe(false);
    expect(lesson.words.find((w) => w.id === "w12-16")!.examples[0].glosses![4].wordId).toBe("w13-20");
  });
  it("разметка меняет ревизию слова, а пример без разметки её не трогает", () => {
    const plain = houseOf(content);
    const { revision: _r, ...fields } = plain;
    expect(revisionOf(fields)).toBe(plain.revision);
    expect(houseOf(brokenCopy(withWords(pilot))).revision).not.toBe(plain.revision);
  });
  it("пакет с разметкой читается, а отрезок вне предложения отклоняется", () => {
    const built = brokenCopy(withWords(pilot));
    const pack = built.packages.find((p) => p.words.some((w) => w.id === "w12-16"))!;
    expect(
      parsePackage(JSON.parse(JSON.stringify(pack))).words.find((w) => w.id === "w12-16")!.examples[0].glosses,
    ).toHaveLength(5);
    const broken = JSON.parse(JSON.stringify(pack));
    broken.words.find((w: { id: string }) => w.id === "w12-16").examples[0].glosses[4].length = 40;
    expect(() => parsePackage(broken)).toThrow(ContentError);
    expect(() => parsePackage(broken)).toThrow(/отрезок выходит за предложение/);
    broken.words.find((w: { id: string }) => w.id === "w12-16").examples[0].glosses[4] = {
      start: 1,
      length: 2,
      russian: "x",
    };
    expect(() => parsePackage(broken)).toThrow(/отрезки пересекаются или идут не по порядку/);
  });
});
