import type { ExercisePools } from "./options";
import { DEFAULT_LANGUAGE, voiceFor, type Language, type LanguageProfile, type Voices } from "./language";
import { phraseExercise } from "./phrase-exercise";
import type { SkillSummary } from "./skills";
import { unitKey } from "./refs";
import type { CardKind, CardSnapshot, LearningRef, SessionCard, SessionItem } from "./types";
import { objectiveExercise } from "./word-exercise";

/** Лёгкие признаки доступности проверки: для фразы — наличие перевода и файла аудио. */
export interface CardFacts {
  kind: CardKind;
  hasTranslation?: boolean;
  hasAudio?: boolean;
  language?: Language;
}
export interface AvailabilityContext {
  hasVoice: Voices;
  phrasePool: number;
}
type Of<K extends CardKind> = Extract<SessionCard, { kind: K }>;

/**
 * Описание вида карточки: всё, чем вид отличается в домене. Новый вид добавляется записью здесь
 * и в `STORED_KINDS` хранилища, а не веткой по виду в каждом месте.
 */
export interface KindSpec<K extends CardKind = CardKind> {
  /** Символ вида в облачном снимке; занятые коды не переиспользуются. */
  code: string;
  id(card: Of<K>): string;
  label(card: Of<K>): string;
  snapshot(card: Of<K>): CardSnapshot;
  /** Греческая сторона и значение — для строки «Сделано». */
  sides(card: Of<K>): { greek: string; meaning: string };
  exercise(
    card: Of<K>,
    pools: ExercisePools,
    skills: SkillSummary,
    random: () => number,
    hasVoice: boolean,
    profile: LanguageProfile,
  ): Pick<SessionItem, "type" | "options"> | null;
  /** Можно ли спросить карточку, не читая её текста; без функции — вид спрашивается всегда. */
  checkable?(facts: CardFacts, context: AvailabilityContext): boolean;
  /** Содержимое может исчезнуть, пока у карточки есть состояние: такую карточку со сроком план проверяет на наличие. */
  vanishes?: boolean;
}

const word: KindSpec<"word"> = {
  code: "w",
  id: (card) => card.word.id,
  label: (card) => card.word.greek,
  snapshot: (card) => ({ greek: card.word.greek, russian: card.word.russian }),
  sides: (card) => ({ greek: card.word.greek, meaning: card.word.russian }),
  exercise: (card, pools, skills, random, hasVoice, profile) =>
    objectiveExercise(card.word, pools.words, skills, random, hasVoice, profile),
};
/** Фраза без перевода проверяется только аудированием: нужны голос или файл и четыре различных фразы в пуле. */
const phrase: KindSpec<"phrase"> = {
  code: "p",
  id: (card) => card.phrase.id,
  label: (card) => card.phrase.text,
  snapshot: (card) => ({
    text: card.phrase.text,
    ...(card.phrase.translation ? { translation: card.phrase.translation } : {}),
  }),
  sides: (card) => ({ greek: card.phrase.text, meaning: card.phrase.translation ?? "" }),
  exercise: (card, pools, skills, random, hasVoice) =>
    phraseExercise(card.phrase, pools.phrases, skills, random, hasVoice),
  checkable: (facts, context) =>
    !!facts.hasTranslation ||
    ((!!facts.hasAudio || voiceFor(context.hasVoice, facts.language ?? DEFAULT_LANGUAGE)) && context.phrasePool >= 4),
};

const SPECS: { [K in CardKind]: KindSpec<K> } = { word, phrase };
/** Описание вида по виду карточки: сужение `card.kind` до записи TypeScript здесь не выводит. */
export const KINDS = SPECS as unknown as Record<CardKind, KindSpec<CardKind>>;
const BY_CODE = new Map(Object.entries(SPECS).map(([kind, spec]) => [spec.code, kind as CardKind]));
/** Вид по коду облака; `undefined` — вид, которого эта версия не знает. */
export const kindOfCode = (code: string): CardKind | undefined => BY_CODE.get(code);

export const cardKey = (card: SessionCard) => unitKey({ kind: card.kind, id: KINDS[card.kind].id(card) });
export const cardLabel = (card: SessionCard) => KINDS[card.kind].label(card);
export const snapshotOf = (card: SessionCard) => KINDS[card.kind].snapshot(card);
export const cardSides = (card: SessionCard) => KINDS[card.kind].sides(card);
export const isCheckable = (facts: CardFacts, context: AvailabilityContext) =>
  KINDS[facts.kind].checkable?.(facts, context) ?? true;
/** Нужны ли плану признаки карточки этого вида, чтобы решить, можно ли её спросить. */
export const needsFacts = (ref: LearningRef) => !!KINDS[ref.kind].checkable;
