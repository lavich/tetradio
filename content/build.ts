import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCatalog,
  SCHEMA_VERSION,
  type Catalog,
  type ContentPackage,
  type PackagePhrase,
  type PackageWord,
} from "../src/content/schema.ts";
import { LEGACY_FILE, type ArtReport } from "./art.ts";
import { checkCardAudio, type CardVoicing } from "./build/card-audio.ts";
import { VERB_GROUPS } from "../src/domain/card-fields.ts";
import { buildCards } from "./build/cards.ts";
import { checkBudgets } from "./build/budgets.ts";
import { buildCourses } from "./build/courses.ts";
import { buildLessons, checkCoverage, type VoicingReport } from "./build/lessons.ts";
import { markCourses, type MarksReport } from "./build/mark-courses.ts";
import { buildReadings, type ReadingReport } from "./build/readings.ts";
import { checkQuestions } from "./build/questions.ts";
import { buildMedia } from "./build/media.ts";
import { packLessons, type BuiltFile } from "./build/output.ts";
import { checkSources, checkSourceScripts, readSources, type ContentRoot } from "./build/sources.ts";

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
export type { CardVoicing } from "./build/card-audio.ts";

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
  cardVoicing: CardVoicing;
  readings: ReadingReport[];
  /** Опубликованные модули курса с полкой, где текстов для чтения меньше двух. */
  sparseReadings: string[];
  /** Вопросы к текстам с непройденными словами: «урок: задание.вопрос: слова». */
  unfamiliar: string[];
  /** Модули, опубликованные частично, и чего в них не хватает до полного. */
  partial: { id: string; gaps: string[] }[];
}

/**
 * Публикация контента. Исходники — YAML: одно слово — один файл в `words/<курс>/`, фраза — файл
 * в `phrases/<курс>/`, урок — упорядоченный список карточек в `lessons/`
 * (`words` для словарного урока либо `items` из пар `{kind, id}` для смешанного), иллюстрации и аудио —
 * отдельные файлы в `art/` и `audio/`. Идентификатор карточки — поле `id` (короткий `w001`/`p001` из лексикона),
 * а без него — имя файла: прогресс пользователя не зависит от переименования файлов.
 * Генератор собирает каталог, неизменяемые пакеты уроков и медиа; клиент исходники не читает.
 */
export function buildContent(root = defaultRoot()): BuiltContent {
  const sources = readSources(root);
  checkSources(sources);
  // Письменность карточки проверяется по языку курса её папки, поэтому курсы разбираются до карточек.
  const {
    courseOf,
    courses,
    modules,
    moduleOf,
    checkpoints,
    reviews,
    partial,
    languages,
    moduleLanguages,
    courseLanguages,
  } = buildCourses(sources);
  checkSourceScripts(sources, courseLanguages, languages, moduleLanguages);
  const { voicing: cardVoicing, sources: voiced } = checkCardAudio(sources, courseLanguages);
  const { words, phrases } = buildCards(voiced, courseLanguages);
  const { legacy, art, media } = buildMedia(voiced, words, phrases, cardVoicing.sources);
  const { used, lessonsForModule, drafts, voicing } = buildLessons({
    sources,
    words,
    phrases,
    courseOf,
    languages,
    moduleOf,
    media,
    legacy,
    art,
  });
  // Слова прошлых уроков известны только после разбора всех уроков, поэтому версии считаются после разметки.
  const marks = markCourses(courses, modules, moduleOf, drafts, words, phrases);
  const readings = buildReadings({ sources, courses, modules, moduleOf, drafts, words, phrases, media, legacy, art });
  const unfamiliar = checkQuestions({ courses, modules, moduleOf, drafts, words, phrases });
  const { packages, entries, files } = packLessons(drafts, marks, readings.byLesson, readings.mediaOf);
  const partialModules = checkCoverage({
    sources,
    words,
    phrases,
    used,
    checkpoints,
    reviews,
    lessonsForModule,
    modules,
    partial,
  });
  for (const { item, body } of media.values()) files.push({ path: item.url, body, mimeType: item.mimeType });
  const catalog: Catalog = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    courses,
    lessons: entries,
    ...(modules.length ? { modules } : {}),
  };
  const catalogBody = JSON.stringify(catalog);
  parseCatalog(JSON.parse(catalogBody));
  files.push({ path: "content/catalog.json", body: catalogBody, mimeType: "application/json" });
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
    cardVoicing,
    readings: readings.report,
    sparseReadings: readings.sparse,
    unfamiliar,
    partial: partialModules,
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
  // `CONTENT_ROOT` подменяет исходники для локального просмотра фикстуры; продукт — только из content/.
  const built = writeContent("public", process.env.CONTENT_ROOT || defaultRoot());
  console.log(
    `Контент: ${built.packages.length} пакетов, ${built.words.length} слов, ${built.phrases.length} фраз, ${built.files.length} файлов → public/content`,
  );
  const budgets = checkBudgets(built.files, built.catalog);
  console.log(budgets.summary);
  if (budgets.violations.length) {
    console.error(`Бюджеты контента нарушены:\n- ${budgets.violations.join("\n- ")}`);
    process.exit(1);
  }
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
  const answers = built.voicing.answers;
  console.log(
    `Ответы перевода и пропуска: с записью ${answers.voiced}` +
      (answers.unvoiced
        ? `; без записи ${answers.unvoiced}${answers.stale ? ` (устарело после правки ${answers.stale})` : ""} — звучат синтезом устройства, озвучка: npm run voices -- answers`
        : ""),
  );
  const cards = built.cardVoicing;
  const silentCards = built.words.length + built.phrases.length - cards.voiced;
  console.log(
    `Слова и фразы: с записью ${cards.voiced}` +
      (silentCards
        ? `; без записи ${silentCards}${cards.stale.length ? ` (устарело после правки ${cards.stale.length})` : ""} — звучат синтезом устройства, озвучка: npm run voices -- words phrases`
        : ""),
  );
  for (const reading of built.readings)
    console.log(
      `Чтение ${reading.id} (после ${reading.after}): ${reading.words} слов, знакомо ${reading.known} %, глоссы ${reading.glosses} %, имена ${reading.names} %` +
        (reading.warnings.length ? ` — ${reading.warnings.join("; ")}` : "") +
        (reading.unknown.length ? `; не нашлись: ${[...new Set(reading.unknown)].join(", ")}` : "") +
        (reading.unvoiced ? `; без записи ${reading.unvoiced} предложений — озвучка: npm run voices -- readings` : ""),
    );
  for (const module of built.partial) console.log(`Частично опубликованы: ${module.id} — ${module.gaps.join("; ")}`);
  if (built.sparseReadings.length)
    console.log(`Чтение: меньше двух текстов в модулях ${built.sparseReadings.join(", ")}`);
  if (built.unfamiliar.length) {
    console.log(`Вопросы к текстам: непройденные слова в ${built.unfamiliar.length} вопросах`);
    for (const line of built.unfamiliar) console.log(`  ${line}`);
  }
  const tables = built.words.filter((word) => word.paradigm);
  const byGroup = VERB_GROUPS.map((group) => `${group} ${tables.filter((word) => word.group === group).length}`);
  const irregular = tables.filter((word) => word.irregular).length;
  console.log(
    `Спряжение: таблицы у ${tables.length} глаголов (${byGroup.join(", ")}; неправ. прош. ${irregular}) — весь список: PARADIGM_REPORT=1 node content/build.ts`,
  );
  if (process.env.PARADIGM_REPORT)
    for (const word of tables)
      console.log(
        `  ${word.greek} [${word.group}${word.irregular ? " · неправ. прош." : ""}]: ${word.paradigm!.present.join(" ")} | ${word.paradigm!.past.join(" ")}`,
      );
  // Одно слово с теми же карточками повторяется по урокам и блокам: в отчёте оно одна строка с местами.
  const groups = new Map<string, { text: string; refs: string[]; places: Map<string, number> }>();
  for (const entry of built.marks.ambiguous) {
    const key = `${entry.text}\u0000${entry.refs.join(" ")}`;
    const group = groups.get(key) ?? { text: entry.text, refs: entry.refs, places: new Map() };
    const place = `${entry.lessonId} ${entry.block}.${entry.field}`;
    group.places.set(place, (group.places.get(place) ?? 0) + 1);
    groups.set(key, group);
  }
  const shown = process.env.MARKS_REPORT ? [...groups.values()] : [...groups.values()].slice(0, 5);
  for (const group of shown) {
    const places = [...group.places].map(([place, count]) => (count > 1 ? `${place} ×${count}` : place));
    const listed = process.env.MARKS_REPORT ? places : places.slice(0, 3);
    const more = places.length - listed.length;
    console.log(
      `  «${group.text}» → ${group.refs.join(" или ")}: ${listed.join(", ")}${more > 0 ? ` и ещё ${more}` : ""}`,
    );
  }
  if (shown.length < groups.size) console.log("  … весь список: MARKS_REPORT=1 node content/build.ts");
}
