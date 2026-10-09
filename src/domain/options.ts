import { PROFILES, type LanguageProfile } from "./language";
import type { ExerciseType, Phrase, Word } from "./types";

export const shuffle = <T>(items: T[], random: () => number) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
/** Плитки перемешиваем так, чтобы правильный порядок не выпал сразу готовым. */
export function shuffleTiles(parts: string[], random: () => number): string[] {
  if (parts.length < 2) return [...parts];
  for (let attempt = 0; attempt < 8; attempt++) {
    const mixed = shuffle(parts, random);
    if (mixed.join("") !== parts.join("")) return mixed;
  }
  return [...parts.slice(1), parts[0]];
}
/**
 * Кандидаты в неверные варианты слова: близкие (соседи по уроку и слова занятия) и остальной пул словаря.
 * Пул может случайно содержать близкие слова: они отсеиваются по id, чтобы не обойти потолок.
 */
export interface WordSources {
  close: Word[];
  pool: Word[];
}
/** Больше двух близких вариантов из трёх — и ответ находится по памяти о прошлых карточках занятия. */
export const CLOSE_OPTIONS = 2;
const normAnswer = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("el");
const hasArticle = (word: Word, { article }: LanguageProfile) =>
  article ? article.test(normAnswer(word.greek)) : false;
/**
 * Три различных неверных ответа или `[]`, если их меньше трёх. Форма (есть ли артикль) важнее потолка
 * близких слов, потолок важнее источника: близкие той же формы до потолка → словарь той же формы →
 * близкие той же формы сверх потолка → то же для другой формы. Внутри группы порядок случайный.
 */
export function distractorsFor(
  word: Word,
  sources: WordSources,
  type: ExerciseType,
  random: () => number,
  profile: LanguageProfile = PROFILES.el,
): string[] {
  const key = (w: Word) => (type === "recognition" ? w.russian : w.greek);
  const own = normAnswer(key(word));
  const form = hasArticle(word, profile);
  const closeIds = new Set(sources.close.map((w) => w.id));
  // Ранг: 0 — близкие той же формы, 1 — словарь той же формы, 2 и 3 — то же другой формы.
  // Совпадающий ответ входит во все свои группы и берётся той, до которой очередь дошла раньше:
  // близкий той же формы сверх потолка уступает словарю той же формы, а близкий другой формы — ему же.
  const groups = new Map<string, (string | undefined)[]>();
  const consider = (w: Word, close: boolean) => {
    const value = key(w);
    const norm = value && normAnswer(value);
    if (w.id === word.id || !norm || norm === own) return;
    const rank = (hasArticle(w, profile) === form ? 0 : 2) + (close ? 0 : 1);
    const slots = groups.get(norm) ?? [];
    slots[rank] ??= value;
    groups.set(norm, slots);
  };
  for (const w of sources.close) consider(w, true);
  for (const w of sources.pool) if (!closeIds.has(w.id)) consider(w, false);
  if (groups.size < 3) return [];
  const ranked: [string, string][][] = [[], [], [], []];
  for (const [norm, slots] of groups)
    slots.forEach((value, rank) => value !== undefined && ranked[rank].push([norm, value]));
  const [closeSame, poolSame, closeOther, poolOther] = ranked.map((group) => shuffle(group, random));
  const picked = new Map<string, string>();
  let near = 0;
  const take = (from: [string, string][], close: boolean, capped: boolean) => {
    while (picked.size < 3 && from.length && !(capped && near >= CLOSE_OPTIONS)) {
      const [norm, value] = from.shift()!;
      if (picked.has(norm)) continue;
      picked.set(norm, value);
      if (close) near++;
    }
  };
  take(closeSame, true, true);
  take(poolSame, false, false);
  take(closeSame, true, false);
  take(closeOther, true, true);
  take(poolOther, false, false);
  take(closeOther, true, false);
  return [...picked.values()];
}
/** Четыре варианта слова в случайном порядке: свой ответ и три неверных; `[]` — неверных меньше трёх. */
export function optionsFor(
  word: Word,
  sources: WordSources,
  type: ExerciseType,
  random: () => number,
  profile: LanguageProfile = PROFILES.el,
): string[] {
  const wrong = distractorsFor(word, sources, type, random, profile);
  return wrong.length ? shuffle([type === "recognition" ? word.russian : word.greek, ...wrong], random) : [];
}
/** Четыре различных варианта: свой ответ и три чужих; совпадающие нормализованные ответы не считаются разными. */
function optionsAmong(ownId: string, own: string, pool: [string, string][], random: () => number): string[] {
  const norm = normAnswer;
  const unique = [
    ...new Map(
      pool
        .filter(([id, value]) => id !== ownId && value && norm(value) !== norm(own))
        .map(([id, value]) => [norm(value), [id, value] as const]),
    ).values(),
  ];
  if (unique.length < 3) return [];
  return shuffle(
    [
      own,
      ...shuffle(unique, random)
        .slice(0, 3)
        .map(([, value]) => value),
    ],
    random,
  );
}
/** Варианты для фразы подбираются только среди фраз: по переводу для узнавания, по тексту для аудирования. */
export function phraseOptionsFor(phrase: Phrase, pool: Phrase[], type: ExerciseType, random: () => number): string[] {
  const key = (p: Phrase) => (type === "recognition" ? (p.translation ?? "") : p.text);
  if (!key(phrase)) return [];
  return optionsAmong(
    phrase.id,
    key(phrase),
    pool.map((p) => [p.id, key(p)]),
    random,
  );
}

/** Пулы вариантов ответа: для слова — его близкие слова и пул словаря, для фразы — пул фраз. */
export interface OptionPools {
  words: WordSources;
  phrases: Phrase[];
}
export const NO_WORDS: WordSources = { close: [], pool: [] };
/** Близкие слова карточки: соседи по урокам и остальные слова занятия. Порядок по id: Dexie и снимок отдают соседей по-разному. */
export function closeSources(
  wordId: string,
  mates: Map<string, Word[]>,
  sessionWords: Word[],
  pool: Word[],
): WordSources {
  const close = new Map<string, Word>();
  for (const word of [...(mates.get(wordId) ?? []), ...sessionWords]) if (word.id !== wordId) close.set(word.id, word);
  return { close: [...close.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)), pool };
}
export type ExercisePools = OptionPools;
