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
const EIMAI = "words/greek-a2/eimai.yaml";
const roots: string[] = [];
function demoWith(path: string, edit: (body: string) => string) {
  const root = mkdtempSync(join(tmpdir(), "paradigm-"));
  roots.push(root);
  cpSync(DEMO, root, { recursive: true });
  writeFileSync(join(root, path), edit(readFileSync(join(root, path), "utf8")));
  return root;
}
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
