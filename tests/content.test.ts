import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colorsOf, foreignColors, paletteColors, parseLegacy } from "../content/art";
import { buildContent, revisionOf, wordsOf } from "../content/build";
import { ContentError, parseCatalog, parsePackage, SCHEMA_VERSION } from "../src/content/schema";
import { wordKey } from "../src/domain/refs";
import { stressNote } from "../src/domain/phonetics";

const content = buildContent("tests/fixtures/mechanics");
const seedWords = content.words;
/** Слова фикстуры со своей иллюстрацией в art/: на них проверяется стандарт картинок; картинки библиотеки (pictures.yaml) ему не подчиняются. */
const illustrated = content.words.filter((word) => content.sources.words.get(word.id)!.image);
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
  // Копируется весь контент, с pictures.yaml: новый вид карточек не должен ломать фикстуру.
  for (const entry of readdirSync("tests/fixtures/mechanics"))
    cpSync(join("tests/fixtures/mechanics", entry), join(root, entry), { recursive: true });
  mutate(root);
  try {
    return buildContent(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("состав урока в пакете", () => {
  /** Пакет описывает урок, а не занятие: статус и дата принадлежат пользователю и в поставку не попадают. */
  it("пакет несёт только название урока", () => {
    expect(packageOf("mech-1").lesson).toEqual({ title: "Урок 1.1" });
    expect(packageOf("mech-2").lesson).toEqual({ title: "Урок 1.2" });
    for (const [id, source] of content.sources.lessons)
      expect(Object.keys(source), id).toEqual(expect.not.arrayContaining(["status", "targetDate"]));
  });
  it.each(["mech-2", "mech-3"] as const)("%s: связи пакета повторяют объявленный состав по порядку", (lessonId) => {
    const declared = wordIdsOf(lessonId);
    expect(declared.length).toBeGreaterThan(0);
    expect(wordsOf(content, lessonId)).toHaveLength(declared.length);
    expect(wordsOf(content, lessonId).map((word) => word.id)).toEqual(declared);
  });
  it("повторяющееся слово остаётся одной записью с общим идентификатором во всех пакетах", () => {
    const linked = new Set(content.packages.flatMap((pack) => pack.words.map((word) => word.id)));
    expect(seedWords).toHaveLength(linked.size);
    expect(new Set(seedWords.map((word) => wordKey(word.greek, word.russian))).size).toBe(seedWords.length);
    expect(new Set(seedWords.map((word) => word.id)).size).toBe(seedWords.length);
    // «ο φίλος» объявлен и в 1.2, и в 1.3 — в обоих пакетах одна и та же запись
    const house = seedWords.filter((word) => word.greek === "ο φίλος");
    expect(house).toHaveLength(1);
    expect(packageOf("mech-2").words.some((word) => word.id === house[0].id)).toBe(true);
    const inThird = packageOf("mech-3").words.find((word) => word.id === house[0].id);
    expect(inThird).toEqual(house[0]);
    expect(packageOf("mech-3").media.some((item) => item.id === house[0].imageAssetId)).toBe(true);
  });
});

describe("уроки принадлежат курсам", () => {
  it("каталог отдаёт состав курса, а урок и пакет знают свой курс", () => {
    const mechanics = content.catalog.courses.find((course) => course.id === "mechanics")!;
    expect(mechanics.title).toBe("Механики");
    // Порядок состава задаёт файл курса, порядок пакетов — обход каталога уроков: совпадать они не обязаны.
    expect([...mechanics.lessonIds].sort()).toEqual(content.packages.map((pack) => pack.id).sort());
    expect(mechanics.lessonIds).toEqual(
      readFileSync("tests/fixtures/mechanics/courses/mechanics.yaml", "utf8")
        .split("\n")
        .flatMap((line) => /^\s+- (\S+)$/.exec(line)?.[1] ?? []),
    );
    for (const entry of content.catalog.lessons) expect(entry.courseId, entry.id).toBe("mechanics");
    for (const pack of content.packages) expect(pack.courseId, pack.id).toBe("mechanics");
  });
  it("публикация требует, чтобы урок входил ровно в один курс", () => {
    const mechanics = readFileSync("tests/fixtures/mechanics/courses/mechanics.yaml", "utf8");
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(join(root, "courses", "mechanics.yaml"), mechanics.replace("  - mech-4\n", "")),
      ),
    ).toThrow(/lessons\/mech-4.yaml: урок не входит ни в один курс/);
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(join(root, "courses", "другой.yaml"), "title: Другой курс\nlessons:\n  - mech-4\n"),
      ),
    ).toThrow(/courses\/другой.yaml: урок mech-4 уже входит в курс mechanics/);
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "courses", "mechanics.yaml"), mechanics + "  - lesson-9-9\n")),
    ).toThrow(/courses\/mechanics.yaml: урока lesson-9-9 нет/);
  });
  it("курс несёт язык и требует один язык на все свои уроки", () => {
    expect(content.catalog.courses.find((course) => course.id === "mechanics")!.language).toBe("el");
    const lesson = readFileSync("tests/fixtures/mechanics/lessons/mech-4.yaml", "utf8");
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(join(root, "lessons", "mech-4.yaml"), lesson.replace("language: el", "language: en")),
      ),
    ).toThrow(/courses\/mechanics.yaml: уроки курса на разных языках/);
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
    expect(text).not.toContain("φίλος");
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
      expect(pack.items.map((item) => item.position)).toEqual(pack.items.map((_, i) => i));
      for (const item of pack.media) {
        expect(item.url).toBe(`content/media/${item.id}@${item.version}.svg`);
        expect(Buffer.from(fileOf(item.url).body).toString("utf8")).toMatch(/^<svg\s/);
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
    const house = readFileSync("tests/fixtures/mechanics/words/ο-φίλος.yaml", "utf8");
    expect(() =>
      brokenCopy((root) => {
        writeFileSync(join(root, "words", "дубль.yaml"), house.replace("id: w034", "id: w99-01"));
        writeFileSync(
          join(root, "lessons", "mech-2.yaml"),
          readFileSync("tests/fixtures/mechanics/lessons/mech-2.yaml", "utf8").replace("- w034", "- w99-01"),
        );
      }),
    ).toThrow(/повторяет слово «ο φίλος — друг»/);
    expect(() => brokenCopy((root) => writeFileSync(join(root, "words", "дубль.yaml"), house))).toThrow(
      /идентификатор «w034» уже занят/,
    );
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(
          join(root, "lessons", "mech-2.yaml"),
          readFileSync("tests/fixtures/mechanics/lessons/mech-2.yaml", "utf8").replace("- w034", "- w999"),
        ),
      ),
    ).toThrow(/слова w999 нет/);
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "words", "το-τεστ.yaml"), "greek: το τεστ\nrussian: тест\n")),
    ).toThrow(/не входит ни в один урок/);
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(
          join(root, "art", "ο-φίλος.svg"),
          '<svg xmlns="http://www.w3.org/2000/svg"><text>дом</text></svg>',
        ),
      ),
    ).toThrow(/выдаёт ответ/);
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(join(root, "words", "ο-φίλος.yaml"), house.replace("image: ο-φίλος.svg", "image: нет.svg")),
      ),
    ).toThrow(/файла art\/нет.svg нет/);
    expect(() =>
      brokenCopy((root) =>
        writeFileSync(join(root, "words", "ο-φίλος.yaml"), house.replace('target: "φίλος"', 'target: "φιλαράκος"')),
      ),
    ).toThrow(/не встречается в предложении/);
  });
  it("новое слово без поля id получает идентификатор из имени файла", () => {
    const built = brokenCopy((root) => {
      writeFileSync(join(root, "words", "το-δοκίμιο.yaml"), "greek: το δοκίμιο\nrussian: очерк\n");
      writeFileSync(
        join(root, "lessons", "mech-4.yaml"),
        readFileSync("tests/fixtures/mechanics/lessons/mech-4.yaml", "utf8") + "  - το-δοκίμιο\n",
      );
    });
    expect(built.words.find((word) => word.id === "το-δοκίμιο")).toMatchObject({
      greek: "το δοκίμιο",
      russian: "очерк",
    });
    expect(wordsOf(built, "mech-4").at(-1)!.id).toBe("το-δοκίμιο");
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

describe("фонетика и разбор чтения", () => {
  const house = readFileSync("tests/fixtures/mechanics/words/ο-φίλος.yaml", "utf8");
  it("ударный слог распознаётся по написанию, односложное слово знака не требует", () => {
    expect(stressNote("το σπίτι")).toBe("Ударение на первый слог");
    expect(stressNote("μεγάλος")).toBe("Ударение на второй слог");
    expect(stressNote("η κατσαρόλα")).toBe("Ударение на третий слог");
    expect(stressNote("το φως")).toBe("Слово односложное — знак ударения ему не нужен");
  });
  it("диапазоны разбора чтения указывают на реальные буквы слова", () => {
    const segments = seedWords.flatMap((word) => word.segments.map((segment) => [word, segment] as const));
    expect(segments.length).toBeGreaterThan(0);
    for (const [word, segment] of segments)
      expect(
        word.greek.slice(segment.start, segment.start + segment.text.length),
        `${word.greek}/${segment.text}`,
      ).toBe(segment.text);
    const pot = seedWords.find((word) => word.id === "w093")!;
    expect(pot.segments).toEqual([
      { text: "ππ", ipa: "p", explanation: "двойная согласная читается как одна", start: 4 },
    ]);
  });
  it("публикация отклоняет IPA без косых черт, проверенное слово без IPA и сочетание не из слова", () => {
    const rewrite = (next: string) => () =>
      brokenCopy((root) => writeFileSync(join(root, "words", "ο-φίλος.yaml"), next));
    expect(rewrite(house.replace("ipa: /o ˈfilos/", "ipa: o ˈfilos"))).toThrow(
      /words\/ο-φίλος.yaml.ipa: транскрипция записывается между косыми чертами/,
    );
    expect(rewrite(house.replace("ipa: /o ˈfilos/\n", ""))).toThrow(
      /words\/ο-φίλος.yaml: проверенное слово должно иметь IPA/,
    );
    expect(
      rewrite(`${house.trimEnd()}\nreading:\n  - { text: "ου", ipa: "u", explanation: "ου читается как у" }\n`),
    ).toThrow(/reading\[0\]: сочетание «ου» не найдено в слове «ο φίλος»/);
    // Непроверенное слово публикуется и без транскрипции.
    expect(
      rewrite(house.replace("ipa: /o ˈfilos/\n", "").replace("verified: true", "verified: false"))().words.find(
        (word) => word.id === "w034",
      ),
    ).toMatchObject({ ipa: "", verified: false });
  });
});

/** Стандарт иллюстраций (docs/art-standard.md): палитра — данные, проверки — в публикации, старые файлы — в legacy.txt. */
describe("иллюстрации подчиняются стандарту", () => {
  const legacyText = readFileSync("tests/fixtures/mechanics/art/legacy.txt", "utf8");
  const legacy = parseLegacy(legacyText);
  const house = readFileSync("tests/fixtures/mechanics/words/ο-φίλος.yaml", "utf8");
  const svg = (inner: string, attrs = 'viewBox="0 0 320 220"') =>
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="320" height="220" fill="#e7eefb"/>${inner}</svg>`;
  /** Копия, в которой ο-φίλος.svg перерисован заново и больше не числится унаследованным. */
  const redrawn = (art: string) =>
    brokenCopy((root) => {
      writeFileSync(join(root, "art", "ο-φίλος.svg"), art);
      writeFileSync(join(root, "art", "legacy.txt"), legacyText.replace("ο-φίλος.svg\n", ""));
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
  it("отчёт считает иллюстрации и унаследованные файлы; вне палитры — ровно список legacy.txt", () => {
    expect(content.art).toEqual({ files: illustrated.length, legacy: legacy.size });
    // В фикстуре есть и унаследованные, и нарисованные по стандарту файлы.
    expect(legacy.size).toBeGreaterThan(0);
    expect(legacy.size).toBeLessThan(illustrated.length);
    for (const word of illustrated) {
      const file = content.sources.words.get(word.id)!.image!;
      expect(legacy.has(file), file).toBe(foreignColors(seedArt(word.id)).length > 0);
    }
  });
  it("новая картинка в палитре публикуется, служебные значения и прозрачность допустимы", () => {
    const built = redrawn(
      svg(
        '<path d="M10 10h20" fill="none" stroke="currentColor"/><circle cx="160" cy="110" r="40" fill="#2563EB" opacity="0.5"/><rect x="1" y="1" width="9" height="9" style="fill:#fbbf24;stroke:#1f2937"/>',
      ),
    );
    expect(built.art).toEqual({ files: illustrated.length, legacy: legacy.size - 1 });
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
      /art\/ο-φίλος.svg: цвета вне палитры #abcdef, #fde68a/,
    );
    // Тот же файл в legacy.txt — публикуется и учтён в отчёте
    expect(
      brokenCopy((root) => writeFileSync(join(root, "art", "ο-φίλος.svg"), svg('<circle r="9" fill="#fde68a"/>'))).art,
    ).toEqual({ files: illustrated.length, legacy: legacy.size });
    // Унаследованный файл, который уже в палитре, просят убрать из списка
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "art", "ο-φίλος.svg"), svg('<circle r="9" fill="#2563eb"/>'))),
    ).toThrow(/уже в палитре — уберите его из art\/legacy.txt/);
    // Имя без файла — мусор в списке
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "art", "legacy.txt"), legacyText + "нет.svg\n")),
    ).toThrow(/файла art\/нет.svg нет — уберите имя из списка/);
    // Остальные проверки действуют и для унаследованных файлов
    expect(() =>
      brokenCopy((root) => writeFileSync(join(root, "art", "ο-φίλος.svg"), svg("<text>дом</text>"))),
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
          join(root, "lessons", "mech-4.yaml"),
          readFileSync("tests/fixtures/mechanics/lessons/mech-4.yaml", "utf8") + "  - το-δοκίμιο\n",
        );
      }),
    ).toThrow(/art\/το-δοκίμιο.svg: цвета вне палитры #123456/);
    expect(house).toContain("image: ο-φίλος.svg");
  });
});

/** Разметка слов примера (add-example-word-glosses): отрезки находятся сборкой, ссылки проверяются по каталогу. */
describe("разметка слов примера", () => {
  const house = readFileSync("tests/fixtures/mechanics/words/ο-φίλος.yaml", "utf8");
  const withWords = (words: string) => (root: string) =>
    writeFileSync(join(root, "words", "ο-φίλος.yaml"), `${house.trimEnd()}\n    words:\n${words}`);
  const pilot = [
    '      - { text: "Ο", russian: "артикль м. р." }',
    '      - { text: "φίλος", russian: "друг", word: w034 }',
    '      - { text: "μας", russian: "наш" }',
    '      - { text: "είναι", russian: "есть" }',
    '      - { text: "παντρεμένος", russian: "женатый", word: w095 }',
  ].join("\n");
  const houseOf = (built: ReturnType<typeof buildContent>) => built.words.find((word) => word.id === "w034")!;

  it("отрезки получают смещения в предложении, ссылки и перевод", () => {
    const example = houseOf(brokenCopy(withWords(pilot))).examples[0];
    expect(example.glosses).toEqual([
      { start: 0, length: 1, russian: "артикль м. р." },
      { start: 2, length: 5, russian: "друг", wordId: "w034" },
      { start: 8, length: 3, russian: "наш" },
      { start: 12, length: 5, russian: "есть" },
      { start: 18, length: 11, russian: "женатый", wordId: "w095" },
    ]);
    expect(example.glosses!.map((g) => example.greek.slice(g.start, g.start + g.length))).toEqual([
      "Ο",
      "φίλος",
      "μας",
      "είναι",
      "παντρεμένος",
    ]);
  });
  it("повтор слова размечает следующее вхождение", () => {
    const built = brokenCopy((root) =>
      writeFileSync(
        join(root, "words", "ο-φίλος.yaml"),
        house.replace("Ο φίλος μας είναι παντρεμένος.", "Ο φίλος και ο φίλος.") +
          '    words:\n      - { text: "φίλος", russian: "друг" }\n      - { text: "φίλος", russian: "друг" }\n',
      ),
    );
    expect(houseOf(built).examples[0].glosses!.map((g) => g.start)).toEqual([2, 14]);
  });
  it("сборка отклоняет отсутствующий отрезок, обратный порядок, пустой перевод и неизвестную ссылку", () => {
    expect(() => brokenCopy(withWords('      - { text: "φίλοι", russian: "друзья" }'))).toThrow(
      /words\/ο-φίλος.yaml.examples\[0\].words\[0\]: отрезок «φίλοι» не найден/,
    );
    expect(() =>
      brokenCopy(withWords('      - { text: "μας", russian: "наш" }\n      - { text: "φίλος", russian: "друг" }')),
    ).toThrow(/words\[1\]: отрезок «φίλος» пересекается с предыдущим или стоит не по порядку/);
    expect(() => brokenCopy(withWords('      - { text: "μας", russian: " " }'))).toThrow(
      /words\[0\]: у отрезка «μας» нет перевода/,
    );
    expect(() => brokenCopy(withWords('      - { text: "μας", russian: "наш", word: w99-99 }'))).toThrow(
      /words\[0\]: отрезок «μας» ссылается на слово w99-99, которого нет в каталоге/,
    );
  });
  it("ссылка на слово другого урока принимается", () => {
    // «ο φίλος» есть в уроке 1.2, а «παντρεμένος» в него не входит: ссылка проходит между уроками.
    const lesson = brokenCopy(withWords(pilot)).packages.find((p) => p.id === "mech-2")!;
    expect(lesson.words.some((w) => w.id === "w095")).toBe(false);
    expect(lesson.words.find((w) => w.id === "w034")!.examples[0].glosses![4].wordId).toBe("w095");
  });
  it("разметка меняет ревизию слова, а пример без разметки её не трогает", () => {
    const plain = houseOf(content);
    const { revision: _r, ...fields } = plain;
    expect(revisionOf(fields)).toBe(plain.revision);
    expect(houseOf(brokenCopy(withWords(pilot))).revision).not.toBe(plain.revision);
  });
  it("пакет с разметкой читается, а отрезок вне предложения отклоняется", () => {
    const built = brokenCopy(withWords(pilot));
    const pack = built.packages.find((p) => p.words.some((w) => w.id === "w034"))!;
    expect(
      parsePackage(JSON.parse(JSON.stringify(pack))).words.find((w) => w.id === "w034")!.examples[0].glosses,
    ).toHaveLength(5);
    const broken = JSON.parse(JSON.stringify(pack));
    broken.words.find((w: { id: string }) => w.id === "w034").examples[0].glosses[4].length = 40;
    expect(() => parsePackage(broken)).toThrow(ContentError);
    expect(() => parsePackage(broken)).toThrow(/отрезок выходит за предложение/);
    broken.words.find((w: { id: string }) => w.id === "w034").examples[0].glosses[4] = {
      start: 1,
      length: 2,
      russian: "x",
    };
    expect(() => parsePackage(broken)).toThrow(/отрезки пересекаются или идут не по порядку/);
  });
});
