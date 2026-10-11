import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { buildReadings } from "../content/build/readings";
import { decodeMarks, parsePackage, readingBlock } from "../src/content/schema";

const DEMO = "tests/fixtures/course-demo";
const roots: string[] = [];
/** Копия демо-курса с правкой текстов: исходники фикстуры не меняются. */
function demoWith(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "readings-"));
  roots.push(root);
  cpSync(DEMO, root, { recursive: true });
  for (const [path, body] of Object.entries(files)) writeFileSync(join(root, path), body);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const reading = (fields: string) =>
  `title: Текст\nprovenance: { operation: requested-generation, request: тест, review: none }\n${fields}`;

describe("сборка текстов для чтения", () => {
  it("текст едет в пакете открывающего урока со своей разметкой слов", () => {
    const built = buildContent(DEMO);
    const pack = built.packages.find((p) => p.id === "m01-1")!;
    expect(pack.readings?.map((r) => r.id)).toEqual(["r-m01-anna"]);
    const [text] = pack.readings!;
    expect(text).toMatchObject({ review: "none", words: 28, series: "anna" });
    const marks = decodeMarks(text.marks!, []);
    expect(Object.keys(marks)).toEqual([text.id]);
    expect(marks[text.id].text.map((mark) => text.text.slice(mark.start, mark.start + mark.length))).toContain("Είμαι");
    expect(built.packages.find((p) => p.id === "m01-test")!.readings?.map((r) => r.id)).toEqual(["r-m01-lemesos"]);
    expect(built.readings.find((r) => r.id === "r-m01-anna")!.warnings.join(" ")).toMatch(/вне коридора 120–250/);
  });

  it("пакет с текстами разбирается, а без поля — как раньше", () => {
    const pack = buildContent(DEMO).packages.find((p) => p.id === "m01-1")!;
    const parsed = parsePackage(JSON.parse(JSON.stringify(pack)));
    expect(parsed.readings?.[0].marks?.refs.length).toBeGreaterThan(0);
    const { readings: _readings, ...plain } = pack;
    expect(parsePackage(JSON.parse(JSON.stringify(plain))).readings).toBeUndefined();
  });

  it("трудный текст отклоняется с долей и ненайденными словами", () => {
    const root = demoWith({
      "readings/greek-a2/r-m01-anna.yaml": reading(
        "id: r-m01-anna\nafter: m01-1\ntext: Γεια! Το νοσοκομείο είναι μακριά.",
      ),
    });
    expect(() => buildContent(root)).toThrow(/знакомо [\d.]+ % слов без глосс.*не нашлись: .*νοσοκομείο/);
  });

  it("неизвестный открывающий урок, лишнее поле и id без префикса отклоняются", () => {
    expect(() =>
      buildContent(
        demoWith({ "readings/greek-a2/r-m01-anna.yaml": reading("id: r-m01-anna\nafter: m09-9\ntext: Γεια!") }),
      ),
    ).toThrow(/урока m09-9 нет/);
    expect(() =>
      buildContent(
        demoWith({
          "readings/greek-a2/r-m01-anna.yaml": reading("id: r-m01-anna\nafter: m01-1\nlevel: A1\ntext: Γεια!"),
        }),
      ),
    ).toThrow(/лишние поля level/);
    expect(() =>
      buildContent(
        demoWith({ "readings/greek-a2/r-m01-anna.yaml": reading("id: m01-anna\nafter: m01-1\ntext: Γεια!") }),
      ),
    ).toThrow(/начинается с r-/);
  });

  it("глосса не из текста и имена не списком отклоняются; много глосс — предупреждение", () => {
    expect(() =>
      buildContent(
        demoWith({
          "readings/greek-a2/r-m01-anna.yaml": reading(
            "id: r-m01-anna\nafter: m01-1\ntext: Γεια! Είμαι από τη Ρωσία.\nglosses: [{ text: σπίτι, russian: дом }]",
          ),
        }),
      ),
    ).toThrow(/«σπίτι» не найдено в тексте/);
    expect(() =>
      buildContent(
        demoWith({
          "readings/greek-a2/r-m01-anna.yaml": reading("id: r-m01-anna\nafter: m01-1\ntext: Γεια!\nnames: Άννα"),
        }),
      ),
    ).toThrow(/names — список имён/);
    const built = buildContent(
      demoWith({
        "readings/greek-a2/r-m01-anna.yaml": reading(
          "id: r-m01-anna\nafter: m01-1\ntext: Γεια! Καλημέρα! Είμαι από τη Ρωσία. Γεια!\nnames: [Ρωσία]\nglosses: [{ text: Καλημέρα, russian: доброе утро }]",
        ),
      }),
    );
    expect(built.readings.find((entry) => entry.id === "r-m01-anna")!.warnings.join(" ")).toMatch(
      /глоссы [\d.]+ % слов/,
    );
  });

  it("повтор идентификатора текста отклоняется", () => {
    const root = demoWith({
      "readings/greek-a2/r-copy.yaml": reading("id: r-m01-anna\nafter: m01-1\ntext: Γεια!"),
    });
    expect(() => buildContent(root)).toThrow(/r-m01-anna.*уже занят/);
  });

  it("идентификатор урока с префиксом текстов отклоняется", () => {
    const built = buildContent(DEMO);
    const drafts = new Map(built.packages.map((pack) => [pack.id, pack]));
    drafts.set("r-lesson", drafts.get("m01-1")!);
    expect(() =>
      buildReadings({
        sources: built.sources,
        courses: built.catalog.courses,
        modules: built.catalog.modules ?? [],
        moduleOf: new Map(),
        drafts,
        words: new Map(built.words.map((word) => [word.id, word])),
        phrases: new Map(built.phrases.map((phrase) => [phrase.id, phrase])),
      }),
    ).toThrow(/префикс r- занят/);
  });

  it("блок текста для разметки — блок чтения с его текстом и глоссами", () => {
    expect(
      readingBlock({ id: "r-x", title: "T", text: "Γεια", glosses: [{ text: "Γεια", russian: "привет" }] }),
    ).toEqual({
      type: "reading",
      id: "r-x",
      title: "T",
      text: "Γεια",
      glosses: [{ text: "Γεια", russian: "привет" }],
    });
  });
});
