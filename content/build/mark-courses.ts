import {
  cardRef,
  type CatalogCourse,
  type ContentPackage,
  type MarkCard,
  type PackageMarks,
  type PackagePhrase,
  type PackageWord,
} from "../../src/content/schema.ts";
import type { CatalogModule } from "../../src/content/course.ts";
import type { CardKind } from "../../src/domain/types.ts";
import { profileOf } from "../../src/domain/language.ts";
import { buildMatcher, encodeMarks, lessonMarks, type Ambiguity } from "../marks.ts";

export interface MarksReport {
  lessons: Map<string, { lesson: number; earlier: number }>;
  ambiguous: (Ambiguity & { lessonId: string })[];
  skipped: string[];
}
/** «Прошлые» — по порядку программы, а не по прогрессу учащегося: набор не зависит от устройства. */
export function markCourses(
  courses: CatalogCourse[],
  modules: CatalogModule[],
  moduleOf: Map<string, { id: string; position: number; draft: boolean }>,
  drafts: Map<string, ContentPackage>,
  words: Map<string, PackageWord>,
  phrases: Map<string, PackagePhrase>,
) {
  const packages = new Map<string, PackageMarks>();
  const report: MarksReport = { lessons: new Map(), ambiguous: [], skipped: [] };
  const numberOf = new Map(modules.map((module) => [module.id, module.number]));
  const describeCard = (kind: CardKind, id: string) => {
    if (kind === "word") {
      const word = words.get(id)!;
      return { text: word.greek, russian: word.russian, ipa: word.ipa, forms: word.forms };
    }
    const phrase = phrases.get(id)!;
    return { text: phrase.text, russian: phrase.translation ?? "", ipa: "", forms: undefined };
  };
  for (const course of courses) {
    if (!course.moduleIds) continue;
    const lessons = course.lessonIds.map((id) => drafts.get(id)).filter((pack) => pack !== undefined);
    const cards = new Map<string, { kind: CardKind; id: string }>();
    for (const pack of lessons)
      for (const item of pack.items) cards.set(cardRef(item.kind, item.id), { kind: item.kind, id: item.id });
    const matcher = buildMatcher(
      [...cards].map(([ref, { kind, id }]) => {
        const card = describeCard(kind, id);
        return { ref, text: card.text, forms: card.forms, phrase: kind === "phrase" };
      }),
      profileOf(course.language),
    );
    report.skipped.push(...matcher.skipped);
    const introduced = new Map<string, { at: number; label: string }>();
    lessons.forEach((pack, at) => {
      const own = new Set(pack.items.map((item) => cardRef(item.kind, item.id)));
      if (pack.blocks?.length) {
        // Слово урока лучше прошлого, из прошлых — более позднее: его учащийся помнит лучше.
        const rank = (ref: string) =>
          own.has(ref) ? 0 : introduced.has(ref) ? at - introduced.get(ref)!.at : undefined;
        const found = lessonMarks({ blocks: pack.blocks, matcher, own, rank });
        report.ambiguous.push(...found.ambiguous.map((entry) => ({ ...entry, lessonId: pack.id })));
        const used = new Set<string>();
        let lesson = 0,
          earlier = 0;
        for (const fields of Object.values(found.blocks))
          for (const list of Object.values(fields))
            for (const { ref, kind } of list) {
              if (kind === "lesson") lesson++;
              else {
                earlier++;
                used.add(ref);
              }
            }
        report.lessons.set(pack.id, { lesson, earlier });
        if (lesson + earlier)
          packages.set(
            pack.id,
            encodeMarks(
              found.blocks,
              [...used].sort().map((ref): MarkCard => {
                const { kind, id } = cards.get(ref)!;
                const card = describeCard(kind, id);
                return {
                  ref,
                  greek: card.text,
                  russian: card.russian,
                  ...(card.ipa ? { ipa: card.ipa } : {}),
                  ...(card.forms ? { forms: card.forms } : {}),
                  lesson: introduced.get(ref)!.label,
                };
              }),
            ),
          );
      }
      const placement = moduleOf.get(pack.id)!;
      const label = `${numberOf.get(placement.id)}.${placement.position + 1}`;
      for (const ref of own) if (!introduced.has(ref)) introduced.set(ref, { at, label });
    });
  }
  return { packages, report };
}
