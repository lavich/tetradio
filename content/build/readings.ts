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
import { coverage, share } from "../coverage.ts";
import { buildMatcher, encodeMarks, lessonMarks, type MatchCard } from "../marks.ts";
import { cardDescriber } from "./mark-courses.ts";
import { fail } from "./common.ts";
import type { ContentRoot } from "./sources.ts";

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
const FIELDS = ["id", "title", "after", "series", "text", "glosses", "names", "provenance"];
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
}
interface Input {
  sources: ContentRoot;
  courses: CatalogCourse[];
  modules: CatalogModule[];
  moduleOf: Map<string, { id: string; position: number; draft: boolean }>;
  drafts: Map<string, ContentPackage>;
  words: Map<string, PackageWord>;
  phrases: Map<string, PackagePhrase>;
}
/**
 * Тексты курса по урокам `after`. Словарь текста — карточки и глоссы уроков курса до открывающего включительно
 * (по порядку программы): их учащийся прошёл, когда текст открылся.
 */
export function buildReadings({ sources, courses, modules, moduleOf, drafts, words, phrases }: Input) {
  for (const id of drafts.keys())
    if (id.startsWith(READING_PREFIX)) fail(`lessons/${id}.yaml: префикс ${READING_PREFIX} занят текстами для чтения`);
  const byLesson = new Map<string, PackageReading[]>();
  const report: ReadingReport[] = [];
  const numberOf = new Map(modules.map((module) => [module.id, module.number]));
  const describe = cardDescriber(words, phrases);
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
    // Полка живёт в модуле, а служебные слова и приставки подсчёта — греческие.
    if (!course.moduleIds) fail(`${where}: тексты для чтения бывают только у курса из модулей`);
    if (course.language !== "el") fail(`${where}: тексты для чтения пока только для греческого курса`);
    const text = src.text.normalize("NFC");
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
    const at = course.lessonIds.indexOf(src.after);
    if (at < 0 || !drafts.has(src.after)) fail(`${where}: урока ${src.after} нет в курсе ${course.id}`);
    const lessons = course.lessonIds.slice(0, at + 1).map((lessonId) => drafts.get(lessonId)!);

    const cards = new Map<string, { kind: LessonCardKind; id: string }>();
    const introduced = new Map<string, { at: number; label: string }>();
    lessons.forEach((pack, index) => {
      const placement = moduleOf.get(pack.id);
      const label = placement ? `${numberOf.get(placement.id)}.${placement.position + 1}` : pack.id;
      for (const item of pack.items) {
        const ref = cardRef(item.kind, item.id);
        cards.set(ref, { kind: item.kind, id: item.id });
        if (!introduced.has(ref)) introduced.set(ref, { at: index, label });
      }
    });
    const matchCards: MatchCard[] = [...cards].map(([ref, { kind, id: cardId }]) => {
      const card = describe(kind, cardId);
      return { ref, text: card.text, forms: card.forms, phrase: kind === "phrase" };
    });
    const lessonGlosses = lessons.flatMap((pack) =>
      (pack.blocks ?? []).flatMap((block) =>
        "glosses" in block && block.glosses ? block.glosses.map((g) => g.text) : [],
      ),
    );
    const profile = profileOf(course.language);
    const measured = coverage({
      text,
      glosses,
      names,
      cards: matchCards,
      lessonGlosses,
      profile,
    });
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
    const block = readingBlock(reading);
    const matcher = buildMatcher(matchCards, profile);
    const found = lessonMarks({
      blocks: [block],
      matcher,
      own: new Set(),
      rank: (ref) => (introduced.has(ref) ? at - introduced.get(ref)!.at : undefined),
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
    });
  }
  for (const list of byLesson.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  return { byLesson, report };
}
