/** Окончания выводятся только с тем же ударением и основой от трёх букв: лучше не найти форму, чем привязать чужое слово. */
import { glossSpans, tapFields, type LessonBlock } from "../src/content/course.ts";
import type { BlockMarks, MarkCard, PackageMarks, WordMark } from "../src/content/schema.ts";

export interface MatchCard {
  ref: string;
  text: string;
  forms?: string;
  phrase?: boolean;
}

type Tier = 0 | 1;
interface Pattern {
  tokens: string[];
  gaps: string[];
  ref: string;
  tier: Tier;
}

export const norm = (value: string) => value.normalize("NFC").toLowerCase().replace(/ς/g, "σ");
const normSet = (values: string[]) => new Set(values.map(norm));
const ARTICLES = normSet(["ο", "η", "το", "οι", "τα", "τον", "την", "τη", "του", "της", "των", "τους", "τις", "τ"]);
/** «σε» — и «в», и «тебя», «του» — и «его», и артикль: отдельно (не во фразе) перевод карточки чаще неверен. */
export const HOMOGRAPHS = normSet(["σε", "με", "του", "της", "μου", "σου", "μας", "σας", "τους", "ένα", "τα", "το"]);
const IRREGULAR: Record<string, string[]> = {
  είμαι: ["είσαι", "είναι", "είμαστε", "είστε", "είσαστε", "ήμουν", "ήμουνα", "ήσουν", "ήταν", "ήμασταν", "ήσασταν"],
  πάω: ["πας", "πάει", "πάμε", "πάτε", "πάνε"],
  λέω: ["λες", "λέει", "λέμε", "λέτε", "λένε"],
  τρώω: ["τρως", "τρώει", "τρώμε", "τρώτε", "τρώνε"],
  ακούω: ["ακούς", "ακούει", "ακούμε", "ακούτε", "ακούνε", "ακούν"],
};

const isGreekLetter = (char: string) => /\p{M}/u.test(char) || (/\p{L}/u.test(char) && /\p{Script=Greek}/u.test(char));
const isLetter = (char: string) => /[\p{L}\p{M}]/u.test(char);

const gapKey = (gap: string) => {
  const flat = gap.replace(/[’ʼ′]/g, "'").replace(/\s+/g, " ");
  return flat.trim() ? flat.trim() : " ";
};

interface Token {
  start: number;
  end: number;
  norm: string;
}
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    if (!isLetter(text[at])) {
      at++;
      continue;
    }
    const start = at;
    let greek = true;
    while (at < text.length && isLetter(text[at])) {
      if (!isGreekLetter(text[at])) greek = false;
      at++;
    }
    if (greek) tokens.push({ start, end: at, norm: norm(text.slice(start, at)) });
  }
  return tokens;
}
const gapsOf = (text: string, tokens: Token[]) =>
  tokens.slice(1).map((token, i) => gapKey(text.slice(tokens[i].end, token.start)));

const ACCENTED = /[άέήίόύώΐΰ]/;
const VOWEL = /[αεηιουωάέήίόύώϊϋΐΰ]/;
const letters = (value: string) => [...value].filter((char) => isLetter(char)).length;
const stressOnLastStemSyllable = (stem: string) => {
  const at = [...stem].findLastIndex((char) => ACCENTED.test(char));
  return at >= 0 && ![...stem].slice(at + 1).some((char) => VOWEL.test(char));
};
const stressed = (value: string) => ACCENTED.test(value);

function inflect(word: string, gender: "m" | "f" | "n" | null, adjective = false): string[] {
  const out: string[] = [];
  const add = (stem: string, endings: string[]) => {
    if (letters(stem) >= 3) out.push(...endings.map((ending) => stem + ending));
  };
  const cut = (n: number) => word.slice(0, word.length - n);
  if (gender === "m") {
    if (word.endsWith("ός")) add(cut(2), ["ό", "ού", "οί", "ούς", "έ"]);
    else if (word.endsWith("ος") && stressed(cut(2)))
      add(cut(2), stressOnLastStemSyllable(cut(2)) ? ["ο", "ου", "οι", "ους", "ε"] : ["ο", "οι", "ε"]);
    else if (word.endsWith("άς")) add(cut(2), ["ά"]);
    else if (word.endsWith("ας") && stressed(cut(2))) add(cut(2), ["α"]);
    else if (word.endsWith("ής")) add(cut(2), ["ή"]);
    else if (word.endsWith("ης") && stressed(cut(2))) add(cut(2), ["η"]);
  } else if (gender === "f") {
    if (/[αηάή]$/.test(word)) {
      add(word, ["ς"]);
      // Множественное существительного есть в карточке; у -ση/-ξη оно другое (ερωτήσεις), у прилагательного — -ες.
      if (adjective) add(cut(1), [ACCENTED.test(word.at(-1)!) ? "ές" : "ες"]);
    }
  } else if (gender === "n") {
    if (word.endsWith("ό")) add(cut(1), ["ού", "ά"]);
    else if (word.endsWith("ο") && stressed(cut(1)))
      add(cut(1), stressOnLastStemSyllable(cut(1)) ? ["ου", "α"] : ["α"]);
  }
  return out;
}
function conjugate(word: string): string[] {
  const out: string[] = [];
  const add = (stem: string, endings: string[]) => {
    if (letters(stem) >= 3) out.push(...endings.map((ending) => stem + ending));
  };
  const cut = (n: number) => word.slice(0, word.length - n);
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.endsWith("άω")) add(cut(2), ["άς", "άει", "άμε", "άτε", "άνε", "ούν", "ούμε"]);
  else if (word.endsWith("ώ")) add(cut(1), ["είς", "εί", "ούμε", "είτε", "ούν", "ούνε"]);
  else if (word.endsWith("ομαι") && stressed(cut(4))) add(cut(4), ["εσαι", "εται", "ονται"]);
  // Гласная перед -ω (λέω, κλαίω) спрягается иначе: такие глаголы — только из таблицы неправильных.
  else if (word.endsWith("ω") && stressed(cut(1)) && !VOWEL.test(cut(1).at(-1) ?? ""))
    add(cut(1), ["εις", "ει", "ουμε", "ετε", "ουν", "ουνε"]);
  return out;
}

export function formPieces(forms: string): string[] {
  return forms
    .split(/[;,]/)
    .map((piece) =>
      piece
        .trim()
        .replace(/^(?:[\p{Script=Cyrillic}.\s]+)/u, "")
        .replace(/^θα\s+/u, "")
        .trim(),
    )
    .filter((piece) => [...piece].some(isGreekLetter));
}

export interface Matcher {
  patterns: Map<string, Pattern[]>;
  skipped: string[];
}
export function buildMatcher(cards: MatchCard[]): Matcher {
  const patterns = new Map<string, Pattern[]>();
  const skipped: string[] = [];
  const seen = new Set<string>();
  const add = (surface: string, ref: string, tier: Tier) => {
    const tokens = tokenize(surface);
    if (!tokens.length) return;
    if (tokens.length === 1 && (HOMOGRAPHS.has(tokens[0].norm) || ARTICLES.has(tokens[0].norm))) return;
    const pattern: Pattern = { tokens: tokens.map((t) => t.norm), gaps: gapsOf(surface, tokens), ref, tier };
    const key = `${ref}|${pattern.tokens.join(" ")}|${pattern.gaps.join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    const list = patterns.get(pattern.tokens[0]) ?? [];
    list.push(pattern);
    patterns.set(pattern.tokens[0], list);
  };
  const withArticle = (surface: string, ref: string, tier: Tier) => {
    add(surface, ref, tier);
    const tokens = tokenize(surface);
    if (tokens.length > 1 && ARTICLES.has(tokens[0].norm)) add(surface.slice(tokens[1].start), ref, tier);
  };
  for (const card of cards) {
    const text = card.text.normalize("NFC").trim();
    const tokens = tokenize(text);
    if (tokens.length === 1 && HOMOGRAPHS.has(tokens[0].norm)) skipped.push(`${card.ref} «${text}»`);
    if (card.phrase) {
      add(text, card.ref, 0);
      continue;
    }
    withArticle(text, card.ref, 0);
    const pieces = card.forms ? formPieces(card.forms.normalize("NFC")) : [];
    for (const piece of pieces) withArticle(piece, card.ref, 0);
    // Окончания выводятся только у однословного слова: у сочетаний «ο κυκλικός κόμβος» — лишь формы из карточки.
    const article = tokens.length === 2 && ARTICLES.has(tokens[0].norm) ? tokens[0].norm : null;
    const core = article ? text.slice(tokens[1].start) : tokens.length === 1 ? text : null;
    if (!core) continue;
    const word = core.toLowerCase();
    const gender = article === "ο" ? "m" : article === "η" ? "f" : article === "το" ? "n" : null;
    const labelled = /\p{Script=Cyrillic}/u.test(card.forms ?? "");
    const adjective =
      !article && !labelled && pieces.length === 3 && pieces.every((piece) => tokenize(piece).length === 1);
    // Глагол — по пометам форм или по окончанию -ω/-ομαι; у наречий на -ω (έξω, πάνω) выведенные «формы» не слова и не встретятся.
    const verb =
      !article && (IRREGULAR[word] || /(?:аор|буд|прош)\./u.test(card.forms ?? "") || /(?:ω|ώ|ομαι)$/.test(word));
    const derived: string[] = [];
    if (gender) derived.push(...inflect(word, gender));
    if (adjective) {
      const [m, f, n] = pieces.map((piece) => piece.toLowerCase());
      derived.push(...inflect(m, "m", true), ...inflect(f, "f", true), ...inflect(n, "n", true));
    }
    if (verb) {
      derived.push(...conjugate(word));
      for (const piece of formPieces(card.forms ?? "")) {
        const form = piece.toLowerCase();
        if (tokenize(form).length !== 1) continue;
        // Аорист: единственное число и 3-е множественного сохраняют ударение основы (έγραψα → έγραψες, έγραψαν).
        if (form.endsWith("α")) {
          const stem = form.slice(0, -1);
          if (letters(stem) >= 3) derived.push(stem + "ες", stem + "ε", stem + "αν");
        }
        if (/[ωώ]$/.test(form) && form !== word) {
          derived.push(...conjugate(form));
          if (form.endsWith("ω") && letters(form.slice(0, -1)) >= 3 && stressOnLastStemSyllable(form.slice(0, -1)))
            derived.push(form.slice(0, -1) + "αμε", form.slice(0, -1) + "ατε");
        }
      }
    }
    for (const form of derived) add(form, card.ref, 1);
  }
  return { patterns, skipped };
}

export interface Span {
  start: number;
  length: number;
  ref: string;
}
export interface Candidate extends Span {
  tokens: number;
  tier: Tier;
}

export function candidates(text: string, matcher: Matcher): Candidate[] {
  const tokens = tokenize(text);
  const found: Candidate[] = [];
  tokens.forEach((token, i) => {
    for (const pattern of matcher.patterns.get(token.norm) ?? []) {
      const n = pattern.tokens.length;
      if (i + n > tokens.length) continue;
      let ok = true;
      for (let k = 1; k < n && ok; k++)
        ok =
          tokens[i + k].norm === pattern.tokens[k] &&
          gapKey(text.slice(tokens[i + k - 1].end, tokens[i + k].start)) === pattern.gaps[k - 1];
      if (!ok) continue;
      const end = tokens[i + n - 1].end;
      found.push({ start: token.start, length: end - token.start, ref: pattern.ref, tokens: n, tier: pattern.tier });
    }
  });
  return found;
}

/** Две равные лучшие карточки на одном месте — спорное место: оно не размечается и идёт в отчёт. */
export function choose(
  found: Candidate[],
  rank: (ref: string) => number,
  report?: (span: Span, refs: string[]) => void,
): Span[] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of found) {
    const key = `${candidate.start}:${candidate.length}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const best: (Candidate & { ambiguous: string[] | null })[] = [];
  for (const group of groups.values()) {
    // Слово и фраза из одного слова («Χάθηκα.») — одно и то же: у слова есть транскрипция и формы.
    const phrase = (ref: string) => (ref.startsWith("p:") ? 1 : 0);
    group.sort((a, b) => a.tier - b.tier || rank(a.ref) - rank(b.ref) || phrase(a.ref) - phrase(b.ref));
    const top = group[0];
    const ties = [
      ...new Set(
        group
          .filter(
            (c) =>
              c.tier === top.tier &&
              rank(c.ref) === rank(top.ref) &&
              phrase(c.ref) === phrase(top.ref) &&
              c.ref !== top.ref,
          )
          .map((c) => c.ref),
      ),
    ];
    best.push({ ...top, ambiguous: ties.length ? [top.ref, ...ties] : null });
  }
  best.sort((a, b) => b.tokens - a.tokens || b.length - a.length || a.start - b.start);
  const taken: Span[] = [];
  for (const candidate of best) {
    if (
      taken.some(
        (span) => candidate.start < span.start + span.length && span.start < candidate.start + candidate.length,
      )
    )
      continue;
    const span = { start: candidate.start, length: candidate.length, ref: candidate.ref };
    if (candidate.ambiguous) {
      report?.(span, candidate.ambiguous);
      // Место занято спорным совпадением: более короткое внутри него тоже не размечается.
      taken.push({ ...span, ref: "" });
      continue;
    }
    taken.push(span);
  }
  return taken.filter((span) => span.ref).sort((a, b) => a.start - b.start);
}

export interface LessonMarksInput {
  blocks: LessonBlock[];
  matcher: Matcher;
  own: Set<string>;
  rank: (ref: string) => number | undefined;
}
export interface Ambiguity {
  block: string;
  field: string;
  text: string;
  refs: string[];
}
/** Глосса автора важнее найденного; карточкой она становится, если совпадает с написанием или содержит его. */
export function lessonMarks({ blocks, matcher, own, rank }: LessonMarksInput) {
  const out: BlockMarks = {};
  const ambiguous: Ambiguity[] = [];
  const order = (ref: string) => rank(ref) ?? Infinity;
  for (const block of blocks) {
    const seen = new Set<string>();
    for (const [field, text] of tapFields(block)) {
      const found = candidates(text, matcher).filter((c) => rank(c.ref) !== undefined);
      const report = (span: Span, refs: string[]) =>
        ambiguous.push({ block: block.id, field, text: text.slice(span.start, span.start + span.length), refs });
      let spans: Span[];
      if (block.type === "reading" && block.glosses?.length) {
        const glosses = glossSpans(text, block.glosses);
        const inside = (c: Span, g: { start: number; length: number }) =>
          c.start >= g.start && c.start + c.length <= g.start + g.length;
        const overlaps = (c: Span) => glosses.some((g) => c.start < g.start + g.length && g.start < c.start + c.length);
        spans = choose(
          found.filter((c) => !overlaps(c)),
          order,
          report,
        );
        for (const gloss of glosses) {
          const within = choose(
            found.filter((c) => inside(c, gloss)),
            order,
          );
          // Глосса из нескольких карточек («ο φίλος μου») ни на одну из них не указывает.
          if (within.length === 1) spans.push({ start: gloss.start, length: gloss.length, ref: within[0].ref });
        }
        spans.sort((a, b) => a.start - b.start);
      } else spans = choose(found, order, report);
      if (!spans.length) continue;
      (out[block.id] ??= {})[field] = spans.map((span): WordMark => {
        const lesson = own.has(span.ref);
        const first = lesson && !seen.has(span.ref);
        seen.add(span.ref);
        return { ...span, kind: lesson ? "lesson" : "earlier", first };
      });
    }
  }
  return { blocks: out, ambiguous };
}

export function encodeMarks(blocks: BlockMarks, cards: MarkCard[]): PackageMarks {
  const refs: string[] = [];
  const index = new Map<string, number>();
  const encoded: PackageMarks["blocks"] = {};
  for (const [blockId, fields] of Object.entries(blocks))
    for (const [field, marks] of Object.entries(fields))
      (encoded[blockId] ??= {})[field] = marks.map((mark) => {
        if (!index.has(mark.ref)) index.set(mark.ref, refs.push(mark.ref) - 1);
        return [mark.start, mark.length, index.get(mark.ref)!, mark.first ? 1 : 0];
      });
  return { refs, cards, blocks: encoded };
}
