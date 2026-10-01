import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { buildContent, type BuiltContent } from "../../content/build";

/**
 * Непубликуемая фикстура смешанного урока: собирается во временной копии исходников проекта, в основной каталог
 * не попадает. Тексты — примеры предложений из слов фикстуры механик; реального материала пользователя здесь нет.
 * Курс `mechanics` получает дополнительный урок `lesson-mixed`; прежние уроки собираются без изменений.
 */
const FIXTURE = "tests/fixtures/mechanics";
const WORDS = `${FIXTURE}/words`;
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
    provenance: verbatim(`${WORDS}/γράφω.yaml, examples[0]`, "Γράφω ένα γράμμα."),
  },
  "p-xora": {
    text: "Η Κύπρος είναι μια μικρή χώρα.",
    translation: "Кипр — маленькая страна.",
    usage: "Описание места",
    provenance: verbatim(`${WORDS}/η-χώρα.yaml, examples[0]`, "Η Κύπρος είναι μια μικρή χώρα."),
  },
  "p-paidi": {
    text: "Το παιδί μιλάει ελληνικά.",
    translation: "Ребёнок говорит по-гречески.",
    provenance: verbatim(`${WORDS}/το-παιδί.yaml, examples[0]`, "Το παιδί μιλάει ελληνικά."),
  },
  "p-lemeso": {
    text: "Δουλεύω στη Λεμεσό.",
    translation: "Я работаю в Лимасоле.",
    provenance: verbatim(`${WORDS}/δουλεύω.yaml, examples[0]`, "Δουλεύω στη Λεμεσό."),
  },
  "p-oikogeneia": {
    text: "Η οικογένειά μου μένει στη Ρωσία.",
    translation: "Моя семья живёт в России.",
    note: "Притяжательное μου стоит после существительного.",
    provenance: withNote(`${WORDS}/η-οικογένεια.yaml, examples[0]`, "Η οικογένειά μου μένει στη Ρωσία.", {
      note: requested("Пояснить место μου"),
    }),
  },
  // Фраза без перевода и без аудио: доступна для просмотра, объективного упражнения нет.
  "p-silent": {
    text: "Ο γιος μου είναι γιατρός.",
    provenance: verbatim(`${WORDS}/ο-γιος.yaml, examples[0]`, "Ο γιος μου είναι γιατρός."),
  },
};
export const MIXED_ITEMS = [
  { kind: "phrase", id: "p-grafo" },
  { kind: "word", id: "w070" },
  { kind: "phrase", id: "p-xora" },
  { kind: "phrase", id: "p-paidi" },
  { kind: "phrase", id: "p-lemeso" },
  { kind: "phrase", id: "p-oikogeneia" },
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
  const root = mkdtempSync(join(tmpdir(), "tetradio-mixed-"));
  for (const entry of ["words", "lessons", "art", "courses", "phrases", "audio", "pictures", "pictures.yaml"])
    if (existsSync(join(FIXTURE, entry))) cpSync(join(FIXTURE, entry), join(root, entry), { recursive: true });
  mkdirSync(join(root, "phrases"), { recursive: true });
  for (const [id, doc] of Object.entries(phrases)) writeFileSync(join(root, "phrases", `${id}.yaml`), stringify(doc));
  const items = lesson
    ? undefined
    : [...Object.keys(phrases).map((id) => ({ kind: "phrase", id })), { kind: "word", id: "w070" }];
  writeFileSync(
    join(root, "lessons", `${MIXED_LESSON}.yaml`),
    stringify(lesson ?? { title: "Смешанный урок", language: "el", items }),
  );
  writeFileSync(
    join(root, "courses", "mechanics.yaml"),
    readFileSync(`${FIXTURE}/courses/mechanics.yaml`, "utf8") + `  - ${MIXED_LESSON}\n`,
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
