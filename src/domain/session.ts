import { DEFAULT_LANGUAGE, voiceFor, type Language, type Voices } from "./language";
import { emptySkills, type SkillSummary } from "./skills";
import { exerciseFor } from "./card-exercise";
import { closeSources, NO_WORDS, shuffle } from "./options";
import { makePlan, type PlanSource } from "./plan";
import { unitKey } from "./refs";
import type { LearningRef, Phrase, Session, SessionCard, SessionItem, Word } from "./types";

export interface SessionSource extends PlanSource {
  /** Полное содержимое только выбранных карточек. */
  cardsOf(refs: LearningRef[]): Promise<Map<string, SessionCard>>;
  /** Компактная сводка навыков карточки: синхронизированная база плюс локальные ответы после неё. */
  skillsOf(card: SessionCard): Promise<SkillSummary>;
  /** Пул слов для вариантов ответа; с курсом — слова только этого курса. */
  optionPool(want: number, courseId?: string): Promise<Word[]>;
  /** Живые соседи слов по урокам в окне `LESSON_MATES_RADIUS` позиций, без самих слов. */
  lessonMatesOf(wordIds: string[]): Promise<Map<string, Word[]>>;
  /** Ограниченный пул фраз для вариантов ответа; читается, только если в сессии есть фразы. */
  phrasePool(want: number, courseId?: string): Promise<Phrase[]>;
  /** Язык карточек — язык их курса: по нему выбирается голос упражнения. */
  languagesOf(refs: LearningRef[]): Promise<Map<string, Language>>;
}
export const OPTION_POOL = 48;
/** Заданий в одном занятии: остальное ждёт следующего, сделанное засчитывается сразу. */
export const SESSION_SIZE = 20;
/** Соседи по уроку — не дальше шести позиций в каждую сторону: близкие слова ограничены и в большом уроке. */
export const LESSON_MATES_RADIUS = 6;

export interface SessionInput {
  source: SessionSource;
  now: Date;
  random?: () => number;
  mode?: "scheduled" | "practice";
  refs?: LearningRef[];
  hasVoice?: Voices;
  /** Занятие курса: план, повторения и варианты ответа — только этого курса. */
  courseId?: string;
}
export async function makeSession({
  source,
  now,
  random = Math.random,
  mode = "scheduled",
  refs,
  hasVoice = false,
  courseId,
}: SessionInput): Promise<Session> {
  const plan = await makePlan(source, now, { hasVoice, courseId });
  const size = SESSION_SIZE;
  let chosen: { ref: LearningRef; isNew: boolean }[];
  if (refs) {
    const live = await source.liveKeys(refs);
    const kept = refs.filter((ref) => live.has(unitKey(ref)));
    const states = await source.statesOf(kept);
    chosen = kept.map((ref) => ({ ref, isNew: !states.has(unitKey(ref)) }));
  } else {
    const reserve = Math.ceil(size / 2);
    const newOnes = plan.newRefs.slice(0, reserve);
    const reviews = plan.reviews.slice(0, Math.max(size - newOnes.length, plan.reviews.length ? 1 : 0));
    const extraNew = plan.newRefs.slice(
      newOnes.length,
      Math.min(plan.newRefs.length, newOnes.length + Math.max(0, size - newOnes.length - reviews.length)),
    );
    const taken = [
      ...newOnes.concat(extraNew).map((ref) => ({ ref, isNew: true })),
      ...reviews
        .slice(0, Math.max(0, size - newOnes.length - extraNew.length))
        .map((r) => ({ ref: r.ref, isNew: false })),
    ];
    chosen = shuffle(taken, random).slice(0, size);
  }
  const wanted = chosen.map((entry) => entry.ref);
  const wordIds = wanted.filter((ref) => ref.kind === "word").map((ref) => ref.id);
  const [cards, states, pool, mates, languages] = await Promise.all([
    source.cardsOf(wanted),
    source.statesOf(wanted),
    source.optionPool(OPTION_POOL, courseId),
    source.lessonMatesOf(wordIds),
    source.languagesOf(wanted),
  ]);
  const sessionWords = [...cards.values()].flatMap((card) => (card.kind === "word" ? [card.word] : []));
  // Пул фраз читается только когда в занятии есть фразы: словарная сессия не трогает таблицу фраз.
  const phrases = [...cards.values()].some((card) => card.kind === "phrase")
    ? await source.phrasePool(OPTION_POOL, courseId)
    : [];
  const id = `s-${now.getTime().toString(36)}-${Math.floor(random() * 1e6).toString(36)}`;
  const items: SessionItem[] = [];
  for (const entry of chosen) {
    const key = unitKey(entry.ref);
    const card = cards.get(key);
    if (!card) continue;
    const skills = entry.isNew ? emptySkills() : await source.skillsOf(card);
    const words = card.kind === "word" ? closeSources(card.word.id, mates, sessionWords, pool) : NO_WORDS;
    const language = languages.get(key) ?? DEFAULT_LANGUAGE;
    const exercise = exerciseFor(card, { words, phrases }, skills, random, voiceFor(hasVoice, language));
    if (!exercise) continue; // объективного упражнения нет: карточка остаётся для просмотра
    const origin = entry.isNew ? plan.origins.get(key) : undefined;
    items.push({
      id: `${id}-${items.length}`,
      ref: entry.ref,
      unitKey: key,
      card,
      ...exercise,
      isNew: entry.isNew,
      mode,
      expectedVersion: states.get(key)?.version ?? 0,
      ...(origin ? { lessonTitle: origin.title } : {}),
    });
  }
  return {
    id,
    createdAt: now.toISOString(),
    planDate: plan.today,
    items: spaceSingleIntroduction(items),
    index: 0,
    status: "active",
    activeTimeMs: 0,
    introducedKeys: [],
    ...(courseId ? { courseId } : {}),
  };
}

export function spaceSingleIntroduction(items: SessionItem[]): SessionItem[] {
  const fresh = items.filter((item) => item.isNew && !item.eventId && !item.retryOf);
  if (fresh.length !== 1 || items.some((item) => item.eventId)) return items;
  return [...items.filter((item) => item.id !== fresh[0].id), fresh[0]];
}
