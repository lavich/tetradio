import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { buildContent, type BuiltContent } from "../../content/build";

/**
 * Непубликуемая фикстура смешанного урока: собирается во временной копии исходников проекта, в основной каталог
 * не попадает. Тексты — уже существующие в проекте примеры предложений; реального материала пользователя здесь нет.
 * Курс `leeke` получает дополнительный урок `lesson-mixed`; прежние уроки собираются без изменений.
 */
const SOURCE = "Существующий пример проекта, иллюстрация формата";
const verbatim = (locator: string, excerpt: string) => ({
  sourceLabel: SOURCE,
  locator,
  excerpt,
  operation: "verbatim",
});
/** Пояснение размечено по отдельной просьбе, поэтому у него своё происхождение. */
const requested = (request: string) => ({
  sourceLabel: "Разметка по запросу",
  operation: "requested-transform",
  request,
});
const withNote = (locator: string, excerpt: string, parts: Record<string, unknown>) => ({
  ...verbatim(locator, excerpt),
  parts,
});
export const MIXED_PHRASES: Record<string, Record<string, unknown>> = {
  "p-grafo": {
    text: "Γράφω ένα γράμμα.",
    translation: "Я пишу письмо.",
    provenance: verbatim("content/words/γράφω.yaml, examples[0]", "Γράφω ένα γράμμα."),
  },
  "p-vouno": {
    text: "Το βουνό είναι ψηλό.",
    translation: "Гора высокая.",
    usage: "Описание места",
    provenance: verbatim("content/words/το-βουνό.yaml, examples[0]", "Το βουνό είναι ψηλό."),
  },
  "p-paidi": {
    text: "Το παιδί παίζει στο πάρκο.",
    translation: "Ребёнок играет в парке.",
    provenance: verbatim("content/words/το-παιδί.yaml, examples[0]", "Το παιδί παίζει στο πάρκο."),
  },
  "p-anoixi": {
    text: "Την άνοιξη ανθίζουν τα λουλούδια.",
    translation: "Весной цветут цветы.",
    provenance: verbatim("content/words/η-άνοιξη.yaml, examples[0]", "Την άνοιξη ανθίζουν τα λουλούδια."),
  },
  "p-ilios": {
    text: "Η κόρη βλέπει τον ήλιο και χαμογελάει.",
    translation: "Дочь смотрит на солнце и улыбается.",
    note: "Винительный падеж после переходного глагола.",
    provenance: withNote("content/words/χαμογελώ.yaml, examples[0]", "Η κόρη βλέπει τον ήλιο και χαμογελάει.", {
      note: requested("Пояснить правило падежа"),
    }),
  },
  // Фраза без перевода и без аудио: доступна для просмотра, объективного упражнения нет.
  "p-silent": {
    text: "Το φρύδι της είναι λεπτό.",
    provenance: verbatim("content/words/το-φρύδι.yaml, examples[0]", "Το φρύδι της είναι λεπτό."),
  },
};
export const MIXED_ITEMS = [
  { kind: "phrase", id: "p-grafo" },
  { kind: "word", id: "w11-27" },
  { kind: "phrase", id: "p-vouno" },
  { kind: "phrase", id: "p-paidi" },
  { kind: "phrase", id: "p-anoixi" },
  { kind: "phrase", id: "p-ilios" },
  { kind: "phrase", id: "p-silent" },
];
export const MIXED_LESSON = "lesson-mixed";

export interface MixedFiles {
  phrases?: Record<string, unknown>;
  lesson?: Record<string, unknown>;
  mutate?: (root: string) => void;
}
/** Сборка смешанной фикстуры с переопределениями; исходники проекта копируются во временную папку и удаляются после. */
export function buildMixed({ phrases = MIXED_PHRASES, lesson, mutate }: MixedFiles = {}): BuiltContent {
  const root = mkdtempSync(join(tmpdir(), "lexi-mixed-"));
  for (const dir of ["words", "lessons", "art", "courses", "phrases", "audio"])
    if (existsSync(join("content", dir))) cpSync(join("content", dir), join(root, dir), { recursive: true });
  mkdirSync(join(root, "phrases"), { recursive: true });
  for (const [id, doc] of Object.entries(phrases)) writeFileSync(join(root, "phrases", `${id}.yaml`), stringify(doc));
  const items = lesson
    ? undefined
    : [...Object.keys(phrases).map((id) => ({ kind: "phrase", id })), { kind: "word", id: "w11-27" }];
  writeFileSync(
    join(root, "lessons", `${MIXED_LESSON}.yaml`),
    stringify(lesson ?? { title: "Смешанный урок", language: "el", items }),
  );
  writeFileSync(
    join(root, "courses", "leeke.yaml"),
    readFileSync("content/courses/leeke.yaml", "utf8") + `  - ${MIXED_LESSON}\n`,
  );
  mutate?.(root);
  try {
    return buildContent(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
let built: BuiltContent | null = null;
/** Стандартная смешанная фикстура: собирается один раз на прогон. */
export const mixedContent = () =>
  (built ??= buildMixed({ lesson: { title: "Смешанный урок", language: "el", items: MIXED_ITEMS } }));
export const mixedPackage = (content = mixedContent()) => content.packages.find((pack) => pack.id === MIXED_LESSON)!;
