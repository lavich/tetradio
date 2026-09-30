import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { buildContent, phraseRevisionOf } from "../content/build";
import { parsePackage } from "../src/content/schema";
import { buildMixed, MIXED_LESSON, MIXED_PHRASES, mixedContent, mixedPackage } from "./helpers/mixed-fixture";

const DOC = "docs/lesson-authoring.md",
  TEMPLATES = "docs/lesson-authoring",
  SKILL = ".agents/skills/prepare-lesson/SKILL.md";
/** Примеры употребления всех слов каталога: материал, из которого готовится непубликуемая фикстура. */
const projectExamples = readdirSync("content/words").flatMap((file) =>
  (
    (parse(readFileSync(join("content/words", file), "utf8")) as { examples?: { greek: string; russian: string }[] })
      .examples ?? []
  ).map((example) => ({ ...example, file })),
);
const norm = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim();

describe("шаблоны инструкции", () => {
  it("слово, фраза и смешанный урок из docs/ проходят тот же валидатор, что и каталог", () => {
    const root = mkdtempSync(join(tmpdir(), "lexi-doc-"));
    // Копируются все папки контента: шаблон проверяется рядом с настоящим каталогом, каким бы он ни стал.
    for (const entry of readdirSync("content", { withFileTypes: true }))
      if (entry.isDirectory()) cpSync(join("content", entry.name), join(root, entry.name), { recursive: true });
    mkdirSync(join(root, "phrases"), { recursive: true });
    const copy = (from: string, to: string) =>
      writeFileSync(join(root, to), readFileSync(join(TEMPLATES, from), "utf8"));
    copy("word.yaml", "words/w-example.yaml");
    copy("phrase.yaml", "phrases/p-example.yaml");
    copy("lesson.yaml", "lessons/lesson-example.yaml");
    writeFileSync(
      join(root, "courses/leeke.yaml"),
      `${readFileSync("content/courses/leeke.yaml", "utf8")}  - lesson-example\n`,
    );
    try {
      const built = buildContent(root);
      const pack = built.packages.find((item) => item.id === "lesson-example")!;
      expect(pack.items.map((item) => [item.kind, item.id])).toEqual([
        ["phrase", "p-example"],
        ["word", "w-example"],
      ]);
      expect(pack.phrases[0]).toMatchObject({
        id: "p-example",
        text: "Το δείγμα είναι απλό.",
        translation: "Образец простой.",
      });
      expect(pack.words[0]).toMatchObject({ id: "w-example", greek: "το δείγμα", examples: [{ target: "δείγμα" }] });
      expect(pack.words[0].examples[0].glosses).toEqual([
        { start: 0, length: 2, russian: "артикль ср. р." },
        { start: 3, length: 6, russian: "образец", wordId: "w-example" },
        { start: 10, length: 5, russian: "есть" },
        { start: 16, length: 4, russian: "простой" },
      ]);
      // Пакет проходит и проверку установки, а не только сборку.
      const file = built.files.find(
        (item) => item.path === built.catalog.lessons.find((entry) => entry.id === "lesson-example")!.url,
      )!;
      expect(parsePackage(JSON.parse(file.body as string)).items).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("инструкция ссылается на все шаблоны и на навык, навык — на инструкцию", () => {
    const doc = readFileSync(DOC, "utf8");
    for (const name of ["word", "phrase", "lesson"]) expect(doc, name).toContain(`lesson-authoring/${name}.yaml`);
    expect(doc).toContain("prepare-lesson/SKILL.md");
    // Границы, которые инструкция обязана называть явно.
    for (const rule of [
      "Только присланное и запрошенное",
      "`extract`",
      "`transform`",
      "`generate`",
      "requested-generation",
      "provenance.parts",
    ])
      expect(doc, rule).toContain(rule);
    const skill = readFileSync(SKILL, "utf8");
    expect(skill).toContain("docs/lesson-authoring.md");
    expect(skill).toContain("npm run content");
    expect(skill).toMatch(/не повод перейти в `generate`/);
  });
});

/**
 * Прогон инструкции на непубликуемом примере: фикстура собрана из уже существующих примеров проекта,
 * в основной каталог не попадает (`tests/helpers/mixed-fixture.ts`). Проверяется то, что требует инструкция:
 * ничего не придумано, происхождение отличающихся полей указано, повторная обработка сохраняет идентификаторы.
 */
describe("прогон инструкции на существующем материале проекта", () => {
  const phrases = Object.entries(MIXED_PHRASES) as [
    string,
    {
      text: string;
      translation?: string;
      note?: string;
      provenance: {
        operation: string;
        locator?: string;
        excerpt?: string;
        parts?: Record<string, { operation: string; request?: string }>;
      };
    },
  ][];
  it("тексты фраз есть в материале проекта, новых предложений нет", () => {
    for (const [id, phrase] of phrases) {
      const source = projectExamples.find((example) => norm(example.greek) === norm(phrase.text));
      expect(source, id).toBeTruthy();
      expect(phrase.provenance).toMatchObject({
        operation: "verbatim",
        locator: expect.stringContaining(source!.file),
        excerpt: phrase.text,
      });
    }
  });
  it("переводы взяты из того же материала, нового перевода нет; фраза без перевода им не дополняется", () => {
    for (const [id, phrase] of phrases) {
      const source = projectExamples.find((example) => norm(example.greek) === norm(phrase.text))!;
      if (phrase.translation) expect(norm(phrase.translation), id).toBe(norm(source.russian));
    }
    const silent = MIXED_PHRASES["p-silent"] as { translation?: string };
    expect(silent.translation).toBeUndefined(); // перевода в материале нет и переводить не просили
  });
  it("примечание есть только там, где его просили, и у него своё происхождение", () => {
    const noted = phrases.filter(([, phrase]) => phrase.note);
    const plain = phrases.filter(([, phrase]) => !phrase.note);
    expect(noted.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0); // фраза без примечания полноценна
    for (const [id, phrase] of noted) {
      // Примечания нет в материале: оно по запросу, поэтому происхождение своё.
      expect(phrase.provenance.parts?.note, id).toMatchObject({ operation: "requested-transform" });
      expect(phrase.provenance.parts!.note.request, id).toBeTruthy();
    }
  });
  it("повторная обработка сохраняет идентификаторы: правка текста и позднее примечание меняют только ревизию", () => {
    const before = mixedPackage();
    const typo = {
      ...MIXED_PHRASES["p-vouno"],
      usage: "Описание места и высоты",
    };
    const late = {
      ...MIXED_PHRASES["p-paidi"],
      note: "Место действия названо предлогом «στο».",
      provenance: {
        ...(MIXED_PHRASES["p-paidi"] as { provenance: Record<string, unknown> }).provenance,
        parts: {
          note: {
            sourceLabel: "Разметка по запросу",
            operation: "requested-transform",
            request: "Пояснить предлог",
          },
        },
      },
    };
    const again = buildMixed({
      phrases: { ...MIXED_PHRASES, "p-vouno": typo, "p-paidi": late },
      lesson: {
        title: "Смешанный урок",
        language: "el",
        items: before.items.map((item) => ({ kind: item.kind, id: item.id })),
      },
    });
    const after = again.packages.find((pack) => pack.id === MIXED_LESSON)!;
    expect(after.phrases.map((item) => item.id)).toEqual(before.phrases.map((item) => item.id)); // ID не изменились
    const pair = (id: string) =>
      [before.phrases.find((item) => item.id === id)!, after.phrases.find((item) => item.id === id)!] as const;
    const [oldVouno, newVouno] = pair("p-vouno");
    expect(newVouno.revision).not.toBe(oldVouno.revision);
    expect(newVouno.text).toBe(oldVouno.text);
    const [oldPaidi, newPaidi] = pair("p-paidi");
    expect(oldPaidi.note).toBeUndefined();
    expect(newPaidi.note).toBe("Место действия названо предлогом «στο».");
    expect(newPaidi.revision).not.toBe(oldPaidi.revision);
    expect(newPaidi.revision).toBe(phraseRevisionOf({ ...newPaidi, revision: "" } as never));
    // Нетронутые карточки сохраняют и ID, и ревизию.
    const [oldGrafo, newGrafo] = pair("p-grafo");
    expect(newGrafo).toEqual(oldGrafo);
  });
  it("реальные уроки каталога не изменились: фикстура добавляет только свой урок", () => {
    const real = buildContent();
    const withFixture = mixedContent();
    expect(withFixture.packages.filter((pack) => pack.id !== MIXED_LESSON).map((pack) => pack.id)).toEqual(
      real.packages.map((pack) => pack.id),
    );
    for (const pack of real.packages) {
      const same = withFixture.packages.find((item) => item.id === pack.id)!;
      expect(same.words, pack.id).toEqual(pack.words);
      expect(same.items, pack.id).toEqual(pack.items);
      expect(same.version, pack.id).toBe(pack.version); // ревизии и версии прежних пакетов не сдвинулись
    }
    // Фикстура добавляет только свои карточки: карточки каталога остаются ровно теми же записями.
    const own = withFixture.phrases.filter((item) => real.phrases.some((card) => card.id === item.id));
    expect(own).toEqual(real.phrases);
    expect(withFixture.phrases.length - real.phrases.length).toBe(Object.keys(MIXED_PHRASES).length);
  });
});
