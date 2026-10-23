import "fake-indexeddb/auto";
import "./helpers/self";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { installLesson } from "../src/content/client";
import { AppDatabase } from "../src/storage/db";
import { installLessons, memoryFetcher } from "./helpers/content";

const DEMO = "tests/fixtures/course-demo";
const MECHANICS = "tests/fixtures/mechanics";
const EIMAI = "words/greek-a2/eimai.yaml";
const roots: string[] = [];
function fixtureWith(fixture: string, edits: Record<string, (body: string) => string>) {
  const root = mkdtempSync(join(tmpdir(), "paradigm-"));
  roots.push(root);
  cpSync(fixture, root, { recursive: true });
  for (const [path, edit] of Object.entries(edits))
    writeFileSync(join(root, path), edit(readFileSync(join(root, path), "utf8")));
  return root;
}
const demoWith = (path: string, edit: (body: string) => string) => fixtureWith(DEMO, { [path]: edit });
const mechanicsWith = (edits: Record<string, (body: string) => string>) =>
  fixtureWith(
    MECHANICS,
    Object.fromEntries(Object.entries(edits).map(([file, edit]) => [`words/mechanics/${file}`, edit])),
  );
const withField = (field: string) => (body: string) => body.replace(/^forms: .*$/mu, (line) => `${line}\n${field}`);
const card = (id: string, greek: string, russian: string, forms: string) => () =>
  `id: ${id}\ngreek: ${greek}\nrussian: ${russian}\nforms: ${forms}\n`;
const mechanicsWord = (root: string, greek: string) =>
  buildContent(root)
    .packages.flatMap((pack) => pack.words)
    .find((word) => word.greek === greek)!;
const dbs: AppDatabase[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const db of dbs.splice(0)) {
    db.close();
    await db.delete();
  }
});

describe("таблица спряжения при сборке", () => {
  it("явная таблица карточки едет в пакете", () => {
    const built = buildContent(DEMO);
    const pack = built.packages.find((p) => p.id === "m01-1")!;
    const eimai = pack.words.find((word) => word.greek === "είμαι")!;
    expect(eimai.paradigm?.past).toEqual(["ήμουν", "ήσουν", "ήταν", "ήμασταν", "ήσασταν", "ήταν"]);
    expect(pack.words.find((word) => word.greek === "από")?.paradigm).toBeUndefined();
  });

  it("без явной таблицы неправильный глагол не проходит сборку", () => {
    const root = demoWith(EIMAI, (body) => body.replace(/paradigm:\n(?: {2}.*\n)+/, ""));
    expect(() => buildContent(root)).toThrow(/eimai\.yaml: спряжение «είμαι» не выводится правилами/);
  });

  it("в таблице шесть форм", () => {
    const root = demoWith(EIMAI, (body) => body.replace("ήσασταν, ήταν]", "ήσασταν]"));
    expect(() => buildContent(root)).toThrow(/paradigm\.past: нужны шесть форм/);
  });
});

describe("таблица из третьего лица", () => {
  it("third при явных формах едет в пакете", () => {
    const root = demoWith(EIMAI, (body) => body.replace("paradigm:\n", "paradigm:\n  third: true\n"));
    const pack = buildContent(root).packages.find((p) => p.id === "m01-1")!;
    expect(pack.words.find((word) => word.greek === "είμαι")?.paradigm?.third).toBe(true);
  });
  it("third без форм там, где правила не справляются, не проходит сборку", () => {
    const root = demoWith(EIMAI, (body) => body.replace(/paradigm:\n(?: {2}.*\n)+/, "paradigm:\n  third: true\n"));
    expect(() => buildContent(root)).toThrow(/eimai\.yaml: спряжение «είμαι» не выводится правилами/);
  });
  it("third при одном present без past не проходит сборку", () => {
    const root = demoWith(EIMAI, (body) => body.replace(/ {2}past: .*\n/, "  third: true\n"));
    expect(() => buildContent(root)).toThrow(/paradigm\.past: нужны шесть форм/);
  });
  it("third — только true", () => {
    const root = demoWith(EIMAI, (body) => body.replace("paradigm:\n", "paradigm:\n  third: false\n"));
    expect(() => buildContent(root)).toThrow(/paradigm\.third: ожидалось true/);
  });
});

describe("установка без таблиц", () => {
  it("пакет и слово, поставленные версией без таблиц, ставятся заново", async () => {
    const demo = buildContent(DEMO);
    const db = new AppDatabase("tetradio-paradigm");
    dbs.push(db);
    await db.delete();
    await db.open();
    await installLessons(db, ["m01-1"], memoryFetcher(demo));
    const stale = (await db.packages.get("m01-1"))!;
    await db.packages.put({ ...stale, words: stale.words.map(({ paradigm: _p, ...word }) => word) });
    const id = stale.words.find((word) => word.paradigm)!.id;
    const { paradigm: _p, ...bare } = (await db.words.get(id))!;
    await db.words.put(bare);

    expect((await installLesson("m01-1", db, memoryFetcher(demo))).status).not.toBe("current");
    expect((await db.words.get(id))!.paradigm?.present[0]).toBe("είμαι");
    expect((await installLesson("m01-1", db, memoryFetcher(demo))).status).toBe("current");
  });
});

describe("явная таблица сверяется с карточкой", () => {
  it("первая форма — заглавная", () => {
    const root = demoWith(EIMAI, (body) => body.replace("present: [είμαι,", "present: [είσαι,"));
    expect(() => buildContent(root)).toThrow(/paradigm\.present\[0\]: первая форма — заглавная «είμαι»/);
  });
  it("у не-глагола таблицы нет", () => {
    const root = demoWith(EIMAI, (body) => body.replace(/forms: .*/, "forms: мн. —"));
    expect(() => buildContent(root)).toThrow(/таблица — только у глагола с лицами/);
  });
});

describe("группа глагола при сборке", () => {
  it("группа и признак, выведенные из таблицы, едут у слова", () => {
    expect(mechanicsWord(MECHANICS, "μένω")).toMatchObject({ group: "A", irregular: true });
    expect(mechanicsWord(MECHANICS, "γράφω")).toMatchObject({ group: "A" });
    expect(mechanicsWord(MECHANICS, "γράφω").irregular).toBeUndefined();
    expect(mechanicsWord(MECHANICS, "μιλάω").group).toBe("B1");
    expect(mechanicsWord(MECHANICS, "μπορώ").group).toBe("B2");
  });

  it("без явной группы глагол со сжатым настоящим не проходит сборку", () => {
    const root = mechanicsWith({ "λέω.yaml": (body) => body.replace("group: A\n", "") });
    expect(() => buildContent(root)).toThrow(/words\/mechanics\/λέω\.yaml\.group: группа «λέω» не выводится/);
  });

  it("явная группа λέω едет с признаком неправильного прошедшего", () => {
    expect(mechanicsWord(MECHANICS, "λέω")).toMatchObject({ group: "A", irregular: true });
  });

  it("είμαι — вне групп, с неправильным прошедшим", () => {
    const eimai = buildContent(DEMO)
      .packages.find((p) => p.id === "m01-1")!
      .words.find((word) => word.greek === "είμαι")!;
    expect(eimai).toMatchObject({ group: "other", irregular: true });
  });

  it.each([["group: A"], ["irregular: true"]])("%s у μένω отклоняется: выводится из таблицы", (field) => {
    const root = mechanicsWith({ "μένω.yaml": withField(field) });
    expect(() => buildContent(root)).toThrow(/μένω\.yaml\.(group|irregular): .*выводится из таблицы/);
  });

  it("явный признак заменяет правило в обе стороны", () => {
    const root = mechanicsWith({
      "κάνω.yaml": withField("irregular: true"),
      "έχω.yaml": card("w071", "υπάρχω", "существовать", "прош. υπήρχα; буд. θα υπάρχω\nirregular: false"),
    });
    expect(mechanicsWord(root, "κάνω")).toMatchObject({ group: "A", irregular: true });
    const exists = mechanicsWord(root, "υπάρχω");
    expect(exists.group).toBe("A");
    expect(exists.irregular).toBeUndefined();
  });

  it("незнакомая группа отклоняется с полем", () => {
    const root = mechanicsWith({ "λέω.yaml": (body) => body.replace("group: A", "group: C") });
    expect(() => buildContent(root)).toThrow(/λέω\.yaml\.group: ожидалось A, B1, B2, mid или other/);
  });

  it.each([
    ["κάνω.yaml", 'irregular: "да"', /κάνω\.yaml\.irregular: ожидалось true или false/],
    ["ο-φίλος.yaml", "group: A", /ο-φίλος\.yaml\.group: группа и признак прошедшего — только у глагола с таблицей/],
    [
      "ο-φίλος.yaml",
      "irregular: true",
      /ο-φίλος\.yaml\.irregular: группа и признак прошедшего — только у глагола с таблицей/,
    ],
  ])("%s с «%s» отклоняется с полем", (file, field, error) => {
    const root = mechanicsWith({ [file]: withField(field) });
    expect(() => buildContent(root)).toThrow(error);
  });

  it("у безличного глагола полей нет", () => {
    const root = mechanicsWith({
      "έχω.yaml": card("w071", "βρέχει", "идёт дождь", "аор. έβρεξε; буд. θα βρέξει"),
    });
    const rain = mechanicsWord(root, "βρέχει");
    expect(rain.group).toBeUndefined();
    expect(rain.irregular).toBeUndefined();
  });

  it("карточки подсказки урока и текста для чтения несут поля слова", () => {
    const built = buildContent(DEMO);
    const lessonCard = built.packages.find((p) => p.id === "m01-r1")!.marks!.cards.find((c) => c.ref === "w:eimai");
    const readingCard = built.packages
      .find((p) => p.id === "m01-1")!
      .readings!.flatMap((reading) => reading.marks?.cards ?? [])
      .find((c) => c.ref === "w:eimai");
    expect(lessonCard).toMatchObject({ group: "other", irregular: true });
    expect(readingCard).toMatchObject({ group: "other", irregular: true });
  });
});
