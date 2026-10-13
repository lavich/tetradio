import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { scriptOf } from "../src/domain/script";

const DEMO = "tests/fixtures/course-demo";
const LESSON = "lessons/m01-1.yaml";
const roots: string[] = [];
function demoWith(edit: (body: string) => string) {
  const root = mkdtempSync(join(tmpdir(), "questions-"));
  roots.push(root);
  cpSync(DEMO, root, { recursive: true });
  writeFileSync(join(root, LESSON), edit(readFileSync(join(root, LESSON), "utf8")));
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("язык вопроса", () => {
  it("скобки и цитата в «» язык не меняют", () => {
    expect(scriptOf("Η Όλγα είναι η φίλη της Ιρίνας. (της Ιρίνας — Ирины)")).toBe("el");
    expect(scriptOf("Что Натаса отвечает на «Για εδώ ή για πακέτο;»?")).toBe("ru");
    expect(scriptOf("Сколько лет Ελένη?")).toBe("both");
    expect(scriptOf("15")).toBeUndefined();
  });
});

describe("вопросы к тексту при сборке", () => {
  it("Σωστό и Λάθος — не непройденные слова", () => {
    expect(buildContent(DEMO).unfamiliar.join("\n")).not.toMatch(/Σωστό|Λάθος/);
  });

  it("русский вопрос среди греческих отклоняет сборку", () => {
    const root = demoWith((body) => body.replace("prompt: Η Άννα μένει στη Λεμεσό.", "prompt: Анна живёт в Лимасоле."));
    expect(() => buildContent(root)).toThrow(/m01-1\.yaml: anna-tf: вопросы на греческом и на русском/);
  });

  it("русский вариант у греческого вопроса отклоняет сборку", () => {
    const root = demoWith((body) =>
      body.replace("          - Λάθος\n        answer: Λάθος", "          - нет\n        answer: нет"),
    );
    expect(() => buildContent(root)).toThrow(/anna-tf\.q1: вариант не по-гречески «нет»/);
  });

  it("непройденное слово — в отчёте, сборка проходит", () => {
    const root = demoWith((body) => body.replace("prompt: Η Άννα μένει στη Λεμεσό.", "prompt: Η Άννα κολυμπάει."));
    expect(buildContent(root).unfamiliar).toContain("lessons/m01-1.yaml: anna-tf.q2: непройденные слова: κολυμπάει");
  });

  it("пояснение в скобках снимает слово с отчёта", () => {
    const root = demoWith((body) =>
      body.replace("prompt: Η Άννα μένει στη Λεμεσό.", "prompt: Η Άννα κολυμπάει. (κολυμπάει — плавает)"),
    );
    expect(buildContent(root).unfamiliar.join("\n")).not.toMatch(/κολυμπάει/);
  });

  it("пояснение с коротким тире тоже снимает слово", () => {
    const root = demoWith((body) =>
      body.replace("prompt: Η Άννα μένει στη Λεμεσό.", "prompt: Η Άννα κολυμπάει. (κολυμπάει – плавает)"),
    );
    expect(buildContent(root).unfamiliar.join("\n")).not.toMatch(/κολυμπάει/);
  });
});
