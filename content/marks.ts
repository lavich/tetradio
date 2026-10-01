/**
 * Поиск слов урока в тексте урока при сборке. Карточка даёт написания: слово с артиклем и без, формы из `forms`
 * и частые окончания по части речи, которые выводятся без морфологического словаря. Окончания добавляются только
 * там, где ударение остаётся на том же слоге, а основа не короче трёх букв: лучше не найти форму, чем привязать
 * чужое слово. Поиск идёт по целым греческим словам, фраза совпадает только целиком, длинное совпадение важнее
 * короткого.
 */
import { glossSpans, tapFields, type LessonBlock } from "../src/content/course.ts";
import type { BlockMarks, WordMark } from "../src/content/schema.ts";

export interface MatchCard {
  ref: string;
  /** Написание карточки: слово с артиклем или текст фразы. */
  text: string;
  forms?: string;
  phrase?: boolean;
}

/** Правило, по которому найдено написание: точное важнее выведенного окончания. */
type Tier = 0 | 1;
interface Pattern {
  tokens: string[];
  gaps: string[];
  ref: string;
  tier: Tier;
}

const ARTICLES = new Set(["ο", "η", "το", "οι", "τα", "τον", "την", "τη", "του", "της", "των", "τους", "τις", "τ"]);
/**
 * Однословные карточки-омографы служебных слов: «σε» — и «в», и «тебя», «του» — и «его», и артикль. Отдельно они
 * не ищутся (внутри фразы — да): перевод карточки чаще был бы неверен, чем верен.
 */
export const HOMOGRAPHS = new Set(["σε", "με", "του", "της", "μου", "σου", "μας", "σας", "τους", "ένα", "τα", "το"]);
/** Неправильные глаголы, у которых окончания не выводятся правилом: только частые формы настоящего (и είμαι). */
const IRREGULAR: Record<string, string[]> = {
  είμαι: ["είσαι", "είναι", "είμαστε", "είστε", "είσαστε", "ήμουν", "ήμουνα", "ήσουν", "ήταν", "ήμασταν", "ήσασταν"],
  πάω: ["πας", "πάει", "πάμε", "πάτε", "πάνε"],
  λέω: ["λες", "λέει", "λέμε", "λέτε", "λένε"],
  τρώω: ["τρως", "τρώει", "τρώμε", "τρώτε", "τρώνε"],
  ακούω: ["ακούς", "ακούει", "ακούμε", "ακούτε", "ακούνε", "ακούν"],
};

const isGreekLetter = (char: string) => /\p{M}/u.test(char) || (/\p{L}/u.test(char) && /\p{Script=Greek}/u.test(char));
const isLetter = (char: string) => /[\p{L}\p{M}]/u.test(char);
export const norm = (value: string) => value.normalize("NFC").toLowerCase().replace(/ς/g, "σ");
/** Промежуток между словами: пробелы равны друг другу, остальное (запятая, апостроф) должно совпасть. */
const gapKey = (gap: string) => {
  const flat = gap.replace(/[’ʼ′]/g, "'").replace(/\s+/g, " ");
  return flat.trim() ? flat.trim() : " ";
};

interface Token {
  start: number;
  end: number;
  norm: string;
}
/** Греческие слова текста; слово, слитое с буквами другого алфавита, не считается. */
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
/** Ударение основы — на последнем её слоге (после ударной гласной согласные): окончание его не сдвигает. */
const stressOnLastStemSyllable = (stem: string) => {
  const at = [...stem].findLastIndex((char) => ACCENTED.test(char));
  return at >= 0 && ![...stem].slice(at + 1).some((char) => VOWEL.test(char));
};
const stressed = (value: string) => ACCENTED.test(value);

/** Формы, которые надёжно выводятся из одного слова; пустой список — правило не подходит. */
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
/** Окончания настоящего времени и подобных ему основ (будущее, аорист с ударением на основе). */
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

/** Куски строки форм без помет: «аор. έγραψα; буд. θα γράψω» → «έγραψα», «γράψω». */
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
/** Написания всех карточек; ключ — первое слово написания. */
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
  /** Слово и его вариант без ведущего артикля. */
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
        if (/α$/.test(form) && !form.endsWith("ά")) {
          const stem = form.slice(0, -1);
          if (letters(stem) >= 3) derived.push(stem + "ες", stem + "ε", stem + "αν");
        }
        // Будущее/сослагательное: те же окончания, что у настоящего (θα γράψω → γράψουμε, γράψαμε).
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

/** Все совпадения написаний в тексте, до выбора: на одном месте их может быть несколько. */
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

/**
 * Выбор на тексте: сначала длинные совпадения, на одном месте — точное раньше выведенного, затем порядок
 * предпочтения карточек (`rank`, меньше — лучше: слово урока, затем более поздний прошлый урок). Если лучших
 * карточек на месте две равных — место считается спорным и не размечается.
 */
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
  /** Карточки этого урока. */
  own: Set<string>;
  /** Меньше — предпочтительнее; карточки вне урока и прошлых уроков отсутствуют. */
  rank: (ref: string) => number | undefined;
}
export interface Ambiguity {
  block: string;
  field: string;
  text: string;
  refs: string[];
}
/**
 * Разметка урока: блок → поле → вхождения. Глоссы автора в чтении важнее найденного: совпадения поверх них
 * снимаются, а сама глосса ведёт на карточку, если её текст совпадает с написанием карточки или содержит его.
 */
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
