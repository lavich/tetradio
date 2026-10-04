import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEMA_VERSION,
  type Catalog,
  type ContentPackage,
  type PackagePhrase,
  type PackageWord,
} from "../src/content/schema.ts";
import { LEGACY_FILE, type ArtReport } from "./art.ts";
import { buildCards } from "./build/cards.ts";
import { buildCourses } from "./build/courses.ts";
import { buildLessons, checkCoverage, type VoicingReport } from "./build/lessons.ts";
import { markCourses, type MarksReport } from "./build/mark-courses.ts";
import { buildMedia } from "./build/media.ts";
import { packLessons, type BuiltFile } from "./build/output.ts";
import { checkSourceScripts, readSources, type ContentRoot } from "./build/sources.ts";

export { LANGUAGE } from "./build/common.ts";
export { audioAssetId, imageAssetId, phraseRevisionOf, revisionOf } from "./build/cards.ts";
export { ART_SOURCE } from "./build/media.ts";
export { readSources } from "./build/sources.ts";
export type {
  ContentRoot,
  CourseSource,
  LessonItemSource,
  LessonSource,
  ModuleSource,
  PhraseSource,
  WordSource,
} from "./build/sources.ts";
export type { BuiltFile } from "./build/output.ts";
export type { MarksReport } from "./build/mark-courses.ts";
export type { VoicingReport } from "./build/lessons.ts";

export interface BuiltContent {
  catalog: Catalog;
  packages: ContentPackage[];
  files: BuiltFile[];
  words: PackageWord[];
  phrases: PackagePhrase[];
  sources: ContentRoot;
  art: ArtReport;
  marks: MarksReport;
  voicing: VoicingReport;
}

/**
 * Публикация контента. Исходники — YAML: одно слово — один файл в `words/` с греческим именем, фраза — файл
 * в `phrases/`, урок — упорядоченный список карточек в `lessons/`
 * (`words` для словарного урока либо `items` из пар `{kind, id}` для смешанного), иллюстрации и аудио —
 * отдельные файлы в `art/` и `audio/`. Идентификатор карточки — поле `id` (короткий `w001`/`p001` из лексикона),
 * а без него — имя файла: прогресс пользователя не зависит от переименования файлов.
 * Генератор собирает каталог, неизменяемые пакеты уроков и медиа; клиент исходники не читает.
 */
export function buildContent(root = defaultRoot()): BuiltContent {
  const sources = readSources(root);
  checkSourceScripts(sources);
  const { words, phrases } = buildCards(sources);
  const { legacy, art, media } = buildMedia(sources, words, phrases);
  const { courseOf, courses, modules, moduleOf, checkpoints, reviews } = buildCourses(sources);
  const { used, lessonsForModule, drafts, voicing } = buildLessons({
    sources,
    words,
    phrases,
    courseOf,
    moduleOf,
    media,
    legacy,
    art,
  });
  // Слова прошлых уроков известны только после разбора всех уроков, поэтому версии считаются после разметки.
  const marks = markCourses(courses, modules, moduleOf, drafts, words, phrases);
  const { packages, entries, files } = packLessons(drafts, marks);
  checkCoverage({ sources, words, phrases, used, checkpoints, reviews, lessonsForModule, modules });
  for (const { item, body } of media.values()) files.push({ path: item.url, body, mimeType: item.mimeType });
  const catalog: Catalog = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    courses,
    lessons: entries,
    ...(modules.length ? { modules } : {}),
  };
  files.push({ path: "content/catalog.json", body: JSON.stringify(catalog), mimeType: "application/json" });
  return {
    catalog,
    packages,
    files,
    words: [...words.values()],
    phrases: [...phrases.values()],
    sources,
    art,
    marks: marks.report,
    voicing,
  };
}

export const wordsOf = (content: BuiltContent, lessonId: string) => {
  const pack = content.packages.find((p) => p.id === lessonId);
  return pack
    ? pack.items.filter((item) => item.kind === "word").map((item) => pack.words.find((word) => word.id === item.id)!)
    : [];
};
// Путь строится без `new URL`: в тестах с jsdom глобальный URL разрешает относительный адрес от http, а не от файла.
export const defaultRoot = () => dirname(fileURLToPath(import.meta.url));

/** Папка очищается целиком: она не хранится в репозитории и собирается перед каждой сборкой. */
export function writeContent(publicDir = "public", root = defaultRoot()) {
  const content = buildContent(root);
  rmSync(join(publicDir, "content"), { recursive: true, force: true });
  for (const file of content.files) {
    const target = join(publicDir, file.path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, file.body);
  }
  return content;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // `CONTENT_ROOT` подменяет исходники: e2e-проверки механик собираются на фикстуре, продукт — только из content/.
  const built = writeContent("public", process.env.CONTENT_ROOT || defaultRoot());
  console.log(
    `Контент: ${built.packages.length} пакетов, ${built.words.length} слов, ${built.phrases.length} фраз, ${built.files.length} файлов → public/content`,
  );
  console.log(`Иллюстрации: ${built.art.files}, вне палитры (art/${LEGACY_FILE}): ${built.art.legacy}`);
  const counts = [...built.marks.lessons.values()];
  const sum = (key: "lesson" | "earlier") => counts.reduce((total, entry) => total + entry[key], 0);
  console.log(
    `Слова в тексте: ${sum("lesson")} слов урока и ${sum("earlier")} прошлых уроков в ${counts.filter((c) => c.lesson + c.earlier).length} уроках; спорных мест ${built.marks.ambiguous.length}, омографов вне поиска ${built.marks.skipped.length}`,
  );
  const { voiced, unvoiced, stale } = built.voicing;
  const silent = [...unvoiced.values()].reduce((total, count) => total + count, 0);
  console.log(
    `Аудирование: с записью ${voiced} реплик` +
      (silent
        ? `; без записи ${silent} реплик в ${unvoiced.size} уроках${stale.length ? ` (устарело после правки ${stale.length})` : ""} — звучат синтезом устройства, озвучка: npm run voices -- <урок>`
        : ""),
  );
  const shown = process.env.MARKS_REPORT ? built.marks.ambiguous : built.marks.ambiguous.slice(0, 5);
  for (const entry of shown)
    console.log(`  ${entry.lessonId} ${entry.block}.${entry.field}: «${entry.text}» → ${entry.refs.join(" или ")}`);
  if (shown.length < built.marks.ambiguous.length) console.log("  … весь список: MARKS_REPORT=1 node content/build.ts");
}
