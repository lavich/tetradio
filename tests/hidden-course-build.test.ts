import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { checkBudgets, BUDGETS } from "../content/build/budgets";
import { hiddenFixture } from "./helpers/hidden-fixture";

const FIXTURE = "tests/fixtures/two-courses";
const ENGLISH = ["english", "talk", "travel"];
const full = buildContent(FIXTURE);
const hidden = buildContent(hiddenFixture(ENGLISH));
const stable = (built: typeof full) => ({
  catalog: { ...built.catalog, generatedAt: "" },
  files: built.files.map((file) => [
    file.path,
    typeof file.body === "string" ? file.body.replace(/"generatedAt":"[^"]*"/, "") : file.body.length,
  ]),
});
const message = (root: string) => {
  try {
    buildContent(root);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};

/** Картинки у двух карточек урока скрытого курса. */
function withEnglishArt() {
  const root = hiddenFixture(ENGLISH);
  mkdirSync(join(root, "art"), { recursive: true });
  for (const file of ["ο-φίλος.svg", "η-οικογένεια.svg"])
    copyFileSync(join("tests/fixtures/mechanics/art", file), join(root, "art", file));
  writeFileSync(join(root, "art/legacy.txt"), "ο-φίλος.svg\nη-οικογένεια.svg\n");
  writeFileSync(join(root, "words/english/e0001.yaml"), "greek: to go\nrussian: идти, ехать\nimage: ο-φίλος.svg\n");
  writeFileSync(join(root, "words/english/e0002.yaml"), "greek: the bus\nrussian: автобус\nimage: η-οικογένεια.svg\n");
  return root;
}

describe("скрытый курс не поставляется", () => {
  it("медиа карточек скрытого курса не поставляется", () => {
    const root = withEnglishArt();
    const all = buildContent(root, { shipHidden: true });
    const shipped = buildContent(root);
    const art = (built: typeof all) => built.files.filter((file) => file.path.startsWith("content/media/img-e"));
    expect(art(all)).toHaveLength(2);
    expect(art(shipped)).toHaveLength(0);
  });

  it("каталог без курса, его модулей и уроков", () => {
    expect(full.catalog.courses.map((course) => course.id)).toContain("english");
    expect(hidden.catalog.courses.map((course) => course.id)).toEqual(["greek-a2"]);
    expect((hidden.catalog.modules ?? []).every((module) => module.courseId === "greek-a2")).toBe(true);
    expect(hidden.catalog.lessons.every((lesson) => lesson.courseId === "greek-a2")).toBe(true);
    expect(hidden.hidden.sort()).toEqual([...ENGLISH].sort());
  });

  it("нет пакетов, медиа, слов, фраз и текстов скрытого курса", () => {
    const englishLessons = full.catalog.lessons.filter((lesson) => lesson.courseId !== "greek-a2");
    expect(englishLessons.length).toBeGreaterThan(0);
    const paths = new Set(hidden.files.map((file) => file.path));
    for (const lesson of englishLessons) expect(paths.has(lesson.url)).toBe(false);
    expect(hidden.packages.every((pack) => pack.courseId === "greek-a2")).toBe(true);
    expect(hidden.words.length).toBeGreaterThan(0);
    expect(hidden.words.every((word) => !/^[ec]\d/.test(word.id))).toBe(true);
    const englishMedia = full.packages.filter((pack) => pack.courseId !== "greek-a2").flatMap((pack) => pack.media);
    for (const item of englishMedia) expect(paths.has(item.url)).toBe(false);
  });

  it("греческий курс собран так же, как без скрытия", () => {
    const greek = (built: typeof full) => ({
      lessons: built.catalog.lessons.filter((lesson) => lesson.courseId === "greek-a2"),
      files: built.files.filter((file) => /^content\/(packages\/m|media\/)/.test(file.path)).map((file) => file.path),
    });
    expect(greek(hidden)).toEqual(greek(full));
  });

  it("с shipHidden каталог и файлы полные", () => {
    const shipped = buildContent(hiddenFixture(ENGLISH), { shipHidden: true });
    expect(stable(shipped)).toEqual(stable(full));
  });

  it("без hidden результат прежний", () => {
    expect(stable(buildContent(FIXTURE))).toEqual(stable(full));
  });
});

describe("скрытый курс проверяется", () => {
  it("опечатка алфавита в карточке скрытого курса", () => {
    const root = hiddenFixture(ENGLISH);
    writeFileSync(join(root, "words/english/e0001.yaml"), "greek: tοgo\nrussian: идти\n");
    expect(message(root)).toMatch(/words\/english\/e0001\.yaml/);
  });

  it("идентификатор карточки скрытого курса не может повторять карточку видимого", () => {
    const root = hiddenFixture(ENGLISH);
    writeFileSync(join(root, "words/greek-a2/e0001.yaml"), "greek: γεια\nrussian: привет\n");
    expect(message(root)).toMatch(/идентификатор «e0001» уже занят/);
  });

  it("бюджеты считаются по полному набору", () => {
    const report = checkBudgets(hidden.checked.files, hidden.checked.catalog, { ...BUDGETS, packageGzip: 1 });
    expect(report.violations.some((line) => line.includes("content/packages/e01"))).toBe(true);
  });
});

describe("поле hidden", () => {
  it.each(["false", "да", "1"])("значение %s отклоняется с файлом и полем", (value) => {
    const text = message(hiddenFixture(["english"], value));
    expect(text).toContain("courses/english.yaml");
    expect(text).toContain("hidden");
  });

  it("скрыты все курсы — отказ", () => {
    expect(message(hiddenFixture(["greek-a2", ...ENGLISH]))).toMatch(/все курсы скрыты/);
  });
});
