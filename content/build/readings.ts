import {
  cardRef,
  READING_PREFIX,
  readingBlock,
  type CatalogCourse,
  type ContentPackage,
  type MarkCard,
  type PackagePhrase,
  type PackageReading,
  type PackageWord,
  type ReadingReview,
} from "../../src/content/schema.ts";
import type { CatalogModule } from "../../src/content/course.ts";
import type { LessonCardKind } from "../../src/domain/types.ts";
import { profileOf } from "../../src/domain/language.ts";
import { coverer, share } from "../coverage.ts";
import { buildMatcher, encodeMarks, lessonMarks, type MatchCard } from "../marks.ts";
import { cardDescriber } from "./mark-courses.ts";
import { mediaFor, type BuiltMedia } from "./media.ts";
import {
  lineHash,
  MANIFEST_FILE,
  parseManifest,
  readingCast,
  readingFile,
  type VoiceManifest,
  type VoiceMap,
} from "./voices.ts";
import { sentencesOf } from "../../src/domain/sentences.ts";
import type { ArtReport } from "../art.ts";
import type { PackageMedia } from "../../src/content/schema.ts";
import { fail } from "./common.ts";
import type { ContentRoot, CourseCard, ReadingSource } from "./sources.ts";

/** Пороги проверки текста: ниже `KNOWN` — отказ, выше `GLOSSES` и `NAMES` — предупреждение. */
export const KNOWN = 95;
const GLOSSES = 4;
const NAMES = 10;
/** Коридор длины по номеру модуля открывающего урока; выход за него — предупреждение. */
const CORRIDOR: [last: number, min: number, max: number][] = [
  [4, 120, 250],
  [10, 180, 350],
  [17, 250, 450],
  [24, 350, 600],
];
const FIELDS = ["id", "title", "after", "series", "text", "glosses", "names", "speakers", "narrator", "provenance"];

/** Строка диалога — строка текста, которая начинается с тире. */
const isDialogue = (line: string) => /^\s*—/u.test(line);
export interface VoicedSentence {
  text: string;
  voice: string;
  file: string;
}
/**
 * Предложения текста с голосом и файлом записи: общая для сборки и озвучки, чтобы деление и голоса совпали.
 * Без `speakers` строки диалога читает рассказчик.
 */
export function readingVoicing(
  id: string,
  text: string,
  speakers: string[] | undefined,
  narrator: string | undefined,
  map: VoiceMap,
  where: string,
): VoicedSentence[] {
  const lines = text.split(/\n+/);
  const dialogue = lines.filter(isDialogue).length;
  if (speakers && speakers.length !== dialogue)
    fail(`${where}: строк диалога ${dialogue}, а имён в speakers ${speakers.length}`);
  const cast = readingCast(map, narrator, speakers ?? [], where);
  let line = 0;
  let index = 0;
  return lines.flatMap((row) => {
    const voice = isDialogue(row) && speakers ? cast.lines[line] : cast.narration;
    if (isDialogue(row)) line++;
    return sentencesOf(row).map((sentence) => ({ text: sentence, voice, file: readingFile(id, index++) }));
  });
}
type PlannedSentence = VoicedSentence & { label: string; voices: VoiceMap };
export interface ReadingVoicePlan {
  sentences: PlannedSentence[];
  /** Записи, которых нет или которые сделаны для другого текста либо голоса. */
  pending: PlannedSentence[];
  /** Файлы `readings/…`, которым больше нет предложения. */
  stale: string[];
}
/** План озвучки текстов без сети: что озвучить и что удалить; `existing` — файлы в `audio/readings`. */
export function planReadingVoices(
  readings: Map<string, CourseCard<ReadingSource>>,
  voicesOf: (src: CourseCard<ReadingSource>) => VoiceMap | undefined,
  manifest: VoiceManifest,
  existing: string[],
): ReadingVoicePlan {
  const onDisk = new Set(existing);
  const sentences: ReadingVoicePlan["sentences"] = [];
  const pending: ReadingVoicePlan["pending"] = [];
  const skipped: string[] = [];
  for (const [id, src] of readings) {
    const voices = voicesOf(src);
    if (!voices) {
      skipped.push(`readings/${id}/`);
      continue;
    }
    const where = `readings/${src.file}`;
    const voiced = readingVoicing(
      id,
      src.text.normalize("NFC"),
      src.speakers?.map((name) => name.normalize("NFC")),
      src.narrator?.normalize("NFC"),
      voices,
      where,
    );
    for (const [index, sentence] of voiced.entries()) {
      const entry = { ...sentence, label: `${id}#${index + 1}`, voices };
      sentences.push(entry);
      const done = manifest[sentence.file];
      if (
        !onDisk.has(sentence.file) ||
        done?.voice !== sentence.voice ||
        done.hash !== lineHash(sentence.text, sentence.voice, voices)
      )
        pending.push(entry);
    }
  }
  const planned = new Set(sentences.map((sentence) => sentence.file));
  const recorded = Object.keys(manifest).filter((file) => file.startsWith("readings/"));
  const stale = [...new Set([...existing, ...recorded])]
    .filter((file) => !planned.has(file) && !skipped.some((dir) => file.startsWith(dir)))
    .sort();
  return { sentences, pending, stale };
}
const REVIEWS: readonly ReadingReview[] = ["none", "author", "native"];

export interface ReadingReport {
  id: string;
  after: string;
  words: number;
  known: number;
  glosses: number;
  names: number;
  unknown: string[];
  warnings: string[];
  /** Предложения без свежей записи: звучат синтезом устройства. */
  unvoiced: number;
}
interface Input {
  sources: ContentRoot;
  courses: CatalogCourse[];
  modules: CatalogModule[];
  moduleOf: Map<string, { id: string; position: number; draft: boolean }>;
  drafts: Map<string, ContentPackage>;
  words: Map<string, PackageWord>;
  phrases: Map<string, PackagePhrase>;
  /** Общий словарь медиа: записи предложений попадают в него и в пакет открывающего урока. */
  media: BuiltMedia;
  legacy: Set<string>;
  art: ArtReport;
}
/**
 * Тексты курса по урокам `after`. Словарь текста — карточки и глоссы уроков курса до открывающего включительно
 * (по порядку программы): их учащийся прошёл, когда текст открылся.
 */
export function buildReadings({
  sources,
  courses,
  modules,
  moduleOf,
  drafts,
  words,
  phrases,
  media,
  legacy,
  art,
}: Input) {
  const manifest = parseManifest(sources.files.get(MANIFEST_FILE));
  const mediaOf = new Map<string, PackageMedia[]>();
  for (const id of drafts.keys())
    if (id.startsWith(READING_PREFIX)) fail(`lessons/${id}.yaml: префикс ${READING_PREFIX} занят текстами для чтения`);
  const byLesson = new Map<string, PackageReading[]>();
  const report: ReadingReport[] = [];
  const shelved = new Set<string>();
  const numberOf = new Map(modules.map((module) => [module.id, module.number]));
  const describe = cardDescriber(words, phrases);
  const courseCache = new Map<string, ReturnType<typeof wordsOf>>();
  const wordsOf = (course: CatalogCourse) => {
    const cards = new Map<string, { kind: LessonCardKind; id: string }>();
    const introduced = new Map<string, { at: number; label: string }>();
    const matchCards: MatchCard[] = [];
    const lessonGlosses: { text: string; at: number }[] = [];
    course.lessonIds.forEach((lessonId, index) => {
      const pack = drafts.get(lessonId);
      if (!pack) return;
      const placement = moduleOf.get(pack.id);
      const label = placement ? `${numberOf.get(placement.id)}.${placement.position + 1}` : pack.id;
      for (const item of pack.items) {
        const ref = cardRef(item.kind, item.id);
        if (cards.has(ref)) continue;
        cards.set(ref, { kind: item.kind, id: item.id });
        introduced.set(ref, { at: index, label });
        const card = describe(item.kind, item.id);
        matchCards.push({ ref, text: card.text, forms: card.forms, phrase: item.kind === "phrase", at: index });
      }
      for (const block of pack.blocks ?? [])
        if ("glosses" in block && block.glosses)
          for (const gloss of block.glosses) lessonGlosses.push({ text: gloss.text, at: index });
    });
    const profile = profileOf(course.language);
    const matcher = buildMatcher(matchCards, profile);
    return { cards, introduced, matcher, measure: coverer(matchCards, lessonGlosses, profile, matcher) };
  };
  const courseWords = (course: CatalogCourse) => {
    let cached = courseCache.get(course.id);
    if (!cached) courseCache.set(course.id, (cached = wordsOf(course)));
    return cached;
  };
  for (const [id, src] of sources.readings) {
    const where = `readings/${src.file}`;
    const extra = Object.keys(src).filter((key) => key !== "file" && key !== "course" && !FIELDS.includes(key));
    if (extra.length) fail(`${where}: лишние поля ${extra.join(", ")}`);
    if (!id.startsWith(READING_PREFIX)) fail(`${where}: идентификатор текста начинается с ${READING_PREFIX}`);
    for (const field of ["title", "text", "after"] as const)
      if (typeof src[field] !== "string" || !src[field].trim()) fail(`${where}: нужно поле ${field}`);
    const review = src.provenance?.review ?? "none";
    if (!REVIEWS.includes(review as ReadingReview)) fail(`${where}: provenance.review — ${REVIEWS.join(", ")}`);
    const course = courses.find((entry) => entry.id === src.course)!;
    shelved.add(course.id);
    // Полка живёт в модуле, а служебные слова и приставки подсчёта — греческие.
    if (!course.moduleIds) fail(`${where}: тексты для чтения бывают только у курса из модулей`);
    if (course.language !== "el") fail(`${where}: тексты для чтения пока только для греческого курса`);
    const text = src.text.normalize("NFC");
    if (text.includes("..")) fail(`${where}: многоточие — знаком «…», а не точками: точка делит текст на предложения`);
    if (src.names !== undefined && (!Array.isArray(src.names) || src.names.some((name) => typeof name !== "string")))
      fail(`${where}: names — список имён`);
    if (src.glosses !== undefined && !Array.isArray(src.glosses)) fail(`${where}: glosses — список глосс`);
    const glosses = (src.glosses ?? []).map((gloss, index) => {
      const at = `${where}: glosses[${index}]`;
      if (typeof gloss !== "object" || gloss === null) fail(`${at}: ожидалось { text, russian }`);
      const extra = Object.keys(gloss).filter((key) => key !== "text" && key !== "russian");
      if (extra.length) fail(`${at}: лишние поля ${extra.join(", ")}`);
      if (
        typeof gloss.text !== "string" ||
        typeof gloss.russian !== "string" ||
        !gloss.text.trim() ||
        !gloss.russian.trim()
      )
        fail(`${at}: нужны text и russian`);
      const found = gloss.text.normalize("NFC");
      if (!text.includes(found)) fail(`${at}: «${found}» не найдено в тексте`);
      return { text: found, russian: gloss.russian };
    });
    const names = (src.names ?? []).map((name) => name.normalize("NFC"));
    if (
      src.speakers !== undefined &&
      (!Array.isArray(src.speakers) || src.speakers.some((name) => typeof name !== "string"))
    )
      fail(`${where}: speakers — список имён по строкам диалога`);
    if (src.narrator !== undefined && (typeof src.narrator !== "string" || !src.narrator.trim()))
      fail(`${where}: narrator — имя героя`);
    const at = course.lessonIds.indexOf(src.after);
    const placement = moduleOf.get(src.after);
    if (placement?.draft && course.moduleIds?.includes(placement.id))
      fail(`${where}: урок ${src.after} в модуле-черновике — текст открывается после урока опубликованного модуля`);
    if (at < 0 || !drafts.has(src.after)) fail(`${where}: урока ${src.after} нет в курсе ${course.id}`);
    const { cards, introduced, matcher, measure } = courseWords(course);
    const measured = measure(text, glosses, names, at);
    const known = share(measured.known, measured.total);
    if (known < KNOWN)
      fail(
        `${where}: знакомо ${known} % слов без глосс, нужно не меньше ${KNOWN} %; не нашлись: ${[...new Set(measured.unknown)].join(", ")}`,
      );
    const warnings: string[] = [];
    const glossShare = share(measured.glossed, measured.total);
    const nameShare = share(measured.named, measured.total);
    if (glossShare > GLOSSES) warnings.push(`глоссы ${glossShare} % слов (больше ${GLOSSES} %)`);
    if (nameShare > NAMES) warnings.push(`имена ${nameShare} % слов (больше ${NAMES} %)`);
    const number = numberOf.get(moduleOf.get(src.after)?.id ?? "");
    const corridor = number === undefined ? undefined : CORRIDOR.find(([last]) => number <= last);
    if (corridor && (measured.total < corridor[1] || measured.total > corridor[2]))
      warnings.push(`${measured.total} слов вне коридора ${corridor[1]}–${corridor[2]} для модуля ${number}`);

    const reading: PackageReading = {
      id,
      title: src.title,
      text,
      glosses,
      review: review as ReadingReview,
      words: measured.total,
    };
    if (src.series) reading.series = src.series;
    // Без карты голосов языка текст звучит синтезом устройства.
    const voices = sources.voices.get(course.language);
    let unvoiced = 0;
    if (voices) {
      const sentences = readingVoicing(
        id,
        text,
        src.speakers?.map((name) => name.normalize("NFC")),
        src.narrator?.normalize("NFC"),
        voices,
        where,
      );
      const audio = sentences.map(({ text: sentence, voice, file }, index): string | null => {
        const done = manifest[file];
        if (!done || done.voice !== voice || done.hash !== lineHash(sentence, voice, voices)) {
          unvoiced++;
          return null;
        }
        const assetId = `reading-${id}-${index + 1}`;
        const built = mediaFor(
          assetId,
          file,
          "audio",
          sources.files,
          { alt: "", source: voices.source.replaceAll("{voice}", voice) },
          `${where}: ${file} — npm run voices -- readings`,
          legacy,
          art,
        );
        media.set(assetId, built);
        mediaOf.set(src.after, [...(mediaOf.get(src.after) ?? []), built.item]);
        return assetId;
      });
      if (audio.some(Boolean)) reading.audio = audio;
    } else unvoiced = sentencesOf(text).length;
    const block = readingBlock(reading);
    const found = lessonMarks({
      blocks: [block],
      matcher,
      own: new Set(),
      rank: (ref) => (introduced.has(ref) && introduced.get(ref)!.at <= at ? at - introduced.get(ref)!.at : undefined),
      upto: at,
    });
    const used = [
      ...new Set(
        Object.values(found.blocks).flatMap((fields) =>
          Object.values(fields)
            .flat()
            .map((mark) => mark.ref),
        ),
      ),
    ];
    if (used.length)
      reading.marks = encodeMarks(
        found.blocks,
        used.sort().map((ref): MarkCard => {
          const { kind, id: cardId } = cards.get(ref)!;
          const card = describe(kind, cardId);
          return {
            ref,
            greek: card.text,
            russian: card.russian,
            ...(card.ipa ? { ipa: card.ipa } : {}),
            ...(card.forms ? { forms: card.forms } : {}),
            lesson: introduced.get(ref)!.label,
          };
        }),
      );
    byLesson.set(src.after, [...(byLesson.get(src.after) ?? []), reading]);
    report.push({
      id,
      after: src.after,
      words: measured.total,
      known,
      glosses: glossShare,
      names: nameShare,
      unknown: measured.unknown,
      warnings,
      unvoiced,
    });
  }
  for (const list of byLesson.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  const perModule = new Map<string, number>();
  for (const { after } of report) {
    const module = moduleOf.get(after)?.id;
    if (module) perModule.set(module, (perModule.get(module) ?? 0) + 1);
  }
  const sparse = modules
    .filter((module) => module.status === "published" && shelved.has(module.courseId))
    .filter((module) => (perModule.get(module.id) ?? 0) < 2)
    .map((module) => module.id);
  return { byLesson, report, mediaOf, sparse };
}
