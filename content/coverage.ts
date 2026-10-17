import { glossSpans } from "../src/content/course.ts";
import { ARTICLE_WORDS } from "./greek.ts";
import { PROFILES, type LanguageProfile } from "../src/domain/language.ts";
import { buildMatcher, candidates, formPieces, norm, type MatchCard } from "./marks.ts";

/** Служебные слова, которые курс учит грамматикой, а не карточками: артикли, слитные предлоги, энклитики, частицы. */
const GRAMMAR = new Set(
  [
    ...ARTICLE_WORDS,
    ..."στο στη στην στον στα στους στις σε με σ μ να θα κι μου σου μας σας ένα έναν μία μια αυτό αυτή πιο α".split(
      " ",
    ),
  ].map(norm),
);
/** Частые приставки: общее начало, которое сводится к ним, не делает слово знакомым (καταλαβαίνω ≠ κατάστημα). */
const PREFIXES = ["παρα", "κατα", "μετα", "συν", "συγ", "συμ", "προ", "απο", "επι", "δια", "υπο", "ανα", "εκ", "εξ"];
const STEM = 5;
const BEYOND_PREFIX = 3;

export const bare = (word: string) => norm(word).normalize("NFD").replace(/\p{M}/gu, "");
const common = (a: string, b: string) => {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  return at;
};
/** Основа засчитывается, если общее начало не короче пяти букв и выходит за приставку хотя бы на три. */
function sharesStem(word: string, stems: readonly string[], profile: LanguageProfile) {
  if (word.length < STEM) return false;
  const prefix =
    profile.code === "el" ? Math.max(0, ...PREFIXES.filter((p) => word.startsWith(p)).map((p) => p.length)) : 0;
  const need = Math.max(STEM, prefix ? prefix + BEYOND_PREFIX : 0);
  return stems.some((stem) => common(word, stem) >= need);
}

export interface CoverageInput {
  text: string;
  /** Глоссы этого текста: слова в их вхождениях переведены, но знакомыми от этого не становятся. */
  glosses: { text: string; russian: string }[];
  names: string[];
  /** Карточки уроков до открывающего включительно. */
  cards: MatchCard[];
  /** Глоссы этих уроков. */
  lessonGlosses: string[];
  profile?: LanguageProfile;
}
export interface Coverage {
  total: number;
  /** Знакомо без глосс текста: строгое сопоставление, служебные слова, имена, формы, слова фраз и основы. */
  known: number;
  /** Строго: сопоставление сборщика, служебные слова и имена. */
  strict: number;
  glossed: number;
  named: number;
  unknown: string[];
}
export function coverage({
  text,
  glosses,
  names,
  cards,
  lessonGlosses,
  profile = PROFILES.el,
}: CoverageInput): Coverage {
  return coverer(
    cards,
    lessonGlosses.map((gloss) => ({ text: gloss, at: 0 })),
    profile,
  )(text, glosses, names);
}
/**
 * Сопоставитель и словарь собираются один раз на курс: карточки и знакомые строки помнят урок появления `at`,
 * а текст меряется по уроку `upto` включительно — как по набору карточек уроков до него.
 */
export function coverer(
  cards: MatchCard[],
  lessonGlosses: { text: string; at: number }[],
  profile: LanguageProfile = PROFILES.el,
  matcher = buildMatcher(cards, profile),
) {
  const surfaces = new Map<string, number>();
  const learn = (piece: string, at: number) => {
    for (const token of matcher.tokenize(piece)) {
      const word = bare(token.norm);
      const seen = surfaces.get(word);
      if (seen === undefined || at < seen) surfaces.set(word, at);
    }
  };
  for (const card of cards) {
    const pieces = card.forms ? formPieces(card.forms) : [];
    for (const piece of [card.text, ...pieces]) learn(piece, card.at ?? 0);
  }
  for (const gloss of lessonGlosses) learn(gloss.text, gloss.at);
  const stemsByAt = [...surfaces].filter(([surface]) => surface.length >= STEM).sort((a, b) => a[1] - b[1]);
  const stemViews = new Map<number, string[]>();
  const stemsUpto = (upto: number) => {
    let view = stemViews.get(upto);
    if (!view) {
      const end = stemsByAt.findIndex(([, at]) => at > upto);
      view = stemsByAt.slice(0, end < 0 ? stemsByAt.length : end).map(([surface]) => surface);
      stemViews.set(upto, view);
    }
    return view;
  };
  return (text: string, glosses: CoverageInput["glosses"], names: string[], upto = Infinity): Coverage => {
    const stems = stemsUpto(upto);
    const known = (word: string) => surfaces.get(word) !== undefined && surfaces.get(word)! <= upto;
    const tokens = matcher.tokenize(text);
    const covered = new Set<number>();
    for (const found of candidates(text, matcher, upto))
      for (let at = found.start; at < found.start + found.length; at++) covered.add(at);
    const nameSet = new Set(names.map(norm));
    const glossed = new Set<number>();
    for (const span of glossSpans(text, glosses))
      for (let at = span.start; at < span.start + span.length; at++) glossed.add(at);
    const result: Coverage = { total: tokens.length, known: 0, strict: 0, glossed: 0, named: 0, unknown: [] };
    // Глосса не делает слово знакомым и не мешает ему быть знакомым: доля без глосс от них не зависит.
    for (const token of tokens) {
      const word = bare(token.norm);
      if (glossed.has(token.start)) result.glossed++;
      if (covered.has(token.start) || GRAMMAR.has(token.norm)) {
        result.known++;
        result.strict++;
      } else if (nameSet.has(token.norm)) {
        result.known++;
        result.strict++;
        result.named++;
      } else if (known(word) || sharesStem(word, stems, profile)) result.known++;
      else if (!glossed.has(token.start)) result.unknown.push(text.slice(token.start, token.end));
    }
    return result;
  };
}
export const share = (part: number, total: number) => (total ? Math.round((1000 * part) / total) / 10 : 0);
