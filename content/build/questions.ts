import {
  cardRef,
  type CatalogCourse,
  type ContentPackage,
  type PackagePhrase,
  type PackageWord,
} from "../../src/content/schema.ts";
import type { CatalogModule } from "../../src/content/course.ts";
import type { LessonCardKind } from "../../src/domain/types.ts";
import { profileOf } from "../../src/domain/language.ts";
import { scriptOf } from "../../src/domain/script.ts";
import { coverer } from "../coverage.ts";
import type { MatchCard } from "../marks.ts";
import { fail } from "./common.ts";
import { cardDescriber } from "./mark-courses.ts";

/** Ответы «верно/неверно» названы в инструкции задания. */
const VERDICTS = new Set(["Σωστό", "Λάθος"]);
/** До пробника K1 (модули 1–8) вопросы с выбором ответа — по-русски: греческих вопросительных слов ещё мало. */
const RUSSIAN_THROUGH = 8;
const isVerdict = (block: { items: { options?: string[] }[] }) =>
  block.items.every((item) => (item.options ?? []).every((option) => VERDICTS.has(option)));
const ADJECTIVE = ["η", "ο", "ον", "οι", "ες", "α", "ου", "ους", "ων", "ης", "ε"];
const STRESSED = ["ή", "ό", "όν", "οί", "ές", "ά", "ού", "ούς", "ών", "ής", "έ"];

/** Слово с заглавной не в начале предложения — имя: Ιρίνας, Κύπρο. Дни и месяцы попадают сюда же — для отчёта терпимо. */
function namesIn(text: string): string[] {
  return [...text.matchAll(/(^|[.;!?…—]\s*)?(\p{Lu}\p{L}*)/gmu)]
    .filter((match) => match[1] === undefined)
    .map((match) => match[2]);
}

/** Слова из пояснения «(της Ιρίνας — Ирины)» вопроса вынимаются из текста: учащийся видит их перевод. */
function withoutGlossed(prompt: string, text: string) {
  let out = text;
  for (const match of prompt.matchAll(/\(([^)—–]+)[—–]([^)]*)\)/gu)) {
    const greek = match[1].trim();
    if (greek) out = out.replace(new RegExp(greek.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), " ");
  }
  return out;
}

/** Формы слова, которые карточка не перечисляет: лица из таблицы спряжения и окончания на -ος. */
function inflected(word: PackageWord | undefined): string[] {
  if (!word) return [];
  if (word.paradigm) return [...word.paradigm.present, ...word.paradigm.past];
  const match = /^(?:[οη] )?(\p{L}+)(ος|ός)$/u.exec(word.greek.normalize("NFC"));
  return match ? (match[2] === "ός" ? STRESSED : ADJECTIVE).map((ending) => match[1] + ending) : [];
}

const greekOnly = (block: { items: { prompt: string }[] }) =>
  block.items.every((item) => scriptOf(item.prompt) !== "ru" && scriptOf(item.prompt) !== "both") &&
  block.items.some((item) => scriptOf(item.prompt) === "el");

interface Input {
  courses: CatalogCourse[];
  modules: CatalogModule[];
  moduleOf: Map<string, { id: string }>;
  drafts: Map<string, ContentPackage>;
  words: Map<string, PackageWord>;
  phrases: Map<string, PackagePhrase>;
}

/** Вопросы с выбором ответа к тексту или аудио — на одном языке; непройденные слова греческих вопросов — в отчёт. */
export function checkQuestions({ courses, modules, moduleOf, drafts, words, phrases }: Input) {
  const numberOf = new Map(modules.map((module) => [module.id, module.number]));
  const checkpoints = new Set(modules.flatMap((module) => [module.checkpointId ?? "", ...(module.reviewIds ?? [])]));
  const describe = cardDescriber(words, phrases);
  const cribOf = new Map<string, string[]>();
  for (const module of modules) {
    const first = module.lessonIds[0];
    if (first && module.crib)
      cribOf.set(first, [...module.crib.rows.map(([, value]) => value), module.crib.note ?? ""]);
  }
  const problems: string[] = [];
  const unfamiliar: string[] = [];
  // Язык проверяется во всех уроках, и в черновых модулях: их нет в программе курса до публикации.
  for (const [lessonId, pack] of drafts)
    for (const block of pack.blocks ?? []) {
      if (block.type !== "exercise" || !block.about || block.format !== "choice") continue;
      const where = `lessons/${lessonId}.yaml: ${block.id}`;
      const scripts = new Set(block.items.map((item) => scriptOf(item.prompt)).filter(Boolean));
      if (scripts.has("both")) problems.push(`${where}: вопрос на двух языках — пояснение выносится в скобки`);
      else if (scripts.size > 1) problems.push(`${where}: вопросы на греческом и на русском — в задании один язык`);
      if (scripts.size !== 1 || !scripts.has("el")) continue;
      const placement = moduleOf.get(lessonId);
      const number = placement && numberOf.get(placement.id);
      if (number && number <= RUSSIAN_THROUGH && !checkpoints.has(lessonId) && !isVerdict(block))
        problems.push(`${where}: в модулях 1–${RUSSIAN_THROUGH} вопросы с выбором ответа — по-русски`);
      for (const item of block.items)
        for (const option of item.options ?? [])
          if (!VERDICTS.has(option) && scriptOf(option) !== "el" && scriptOf(option) !== undefined)
            problems.push(`${where}.${item.id}: вариант не по-гречески «${option}»`);
    }
  if (problems.length) fail(`Вопросы к текстам и аудио:\n  ${problems.join("\n  ")}`);
  for (const course of courses) {
    if (!course.moduleIds || course.language !== "el") continue;
    const profile = profileOf(course.language);
    const cards = new Map<string, MatchCard>();
    const known: { text: string; at: number }[] = [];
    course.lessonIds.forEach((lessonId, at) => {
      const pack = drafts.get(lessonId);
      if (!pack) return;
      for (const line of cribOf.get(lessonId) ?? []) known.push({ text: line, at });
      for (const item of pack.items) {
        const ref = cardRef(item.kind, item.id);
        if (cards.has(ref)) continue;
        const card = describe(item.kind as LessonCardKind, item.id);
        cards.set(ref, { ref, text: card.text, forms: card.forms, phrase: item.kind === "phrase", at });
        if (item.kind === "word") for (const form of inflected(words.get(item.id))) known.push({ text: form, at });
      }
      for (const block of pack.blocks ?? [])
        if ("glosses" in block && block.glosses)
          for (const gloss of block.glosses) known.push({ text: gloss.text, at });
    });
    let measure: ReturnType<typeof coverer> | undefined;
    for (const [at, lessonId] of course.lessonIds.entries()) {
      const pack = drafts.get(lessonId);
      if (!pack) continue;
      const blocks = pack.blocks ?? [];
      for (const block of blocks) {
        if (block.type !== "exercise" || !block.about || block.format !== "choice") continue;
        const where = `lessons/${lessonId}.yaml: ${block.id}`;
        if (!greekOnly(block)) continue;
        measure ??= coverer([...cards.values()], known, profile);
        const source = blocks.find((other) => other.id === block.about);
        const sourceText =
          source?.type === "reading"
            ? source.text
            : source?.type === "listening"
              ? source.transcript.map((line) => line.text).join("\n")
              : "";
        const sourceNames = namesIn(sourceText);
        for (const item of block.items) {
          const options = (item.options ?? []).filter((option) => !VERDICTS.has(option));
          const text = withoutGlossed(item.prompt, [item.prompt.replace(/\([^)]*\)/gu, ""), ...options].join("\n"));
          const measured = measure(text, [], [...namesIn(text), ...sourceNames], at);
          if (measured.unknown.length)
            unfamiliar.push(`${where}.${item.id}: непройденные слова: ${[...new Set(measured.unknown)].join(", ")}`);
        }
      }
    }
  }
  return unfamiliar;
}
