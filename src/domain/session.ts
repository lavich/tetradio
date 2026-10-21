import { DEFAULT_LANGUAGE, PROFILES, voiceFor, type Language, type Voices } from "./language";
import { emptySkills, type SkillSummary } from "./skills";
import { exerciseFor } from "./card-exercise";
import { KINDS } from "./kinds";
import { closeSources, NO_WORDS, shuffle } from "./options";
import { makeLanguagePlan, makePlan, originsOf, type PlanSource, type WordOrigin } from "./plan";
import { studyDay } from "./time";
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
  /** Курс карточек; карточка вне уроков — у домашнего курса, бывает и другого языка. */
  coursesOf(refs: LearningRef[]): Promise<Map<string, string>>;
  courseLanguage(courseId: string): Promise<Language>;
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
  /** Занятие языка: план — общий план этих курсов, первый — основной курс языка. */
  courseIds?: string[];
}
export async function makeSession({
  source,
  now,
  random = Math.random,
  mode = "scheduled",
  refs,
  hasVoice = false,
  courseId,
  courseIds,
}: SessionInput): Promise<Session> {
  const scope = courseIds ?? (courseId ? [courseId] : undefined);
  const size = SESSION_SIZE;
  let chosen: { ref: LearningRef; isNew: boolean }[];
  let origins: Map<string, WordOrigin>;
  if (refs) {
    // Выбранным карточкам план не нужен: только источники новых, а состояния со сроком не читаются.
    const live = await source.liveKeys(refs);
    const kept = refs.filter((ref) => live.has(unitKey(ref)));
    const states = await source.statesOf(kept);
    chosen = kept.map((ref) => ({ ref, isNew: !states.has(unitKey(ref)) }));
    origins = await originsOf(
      source,
      chosen.filter((entry) => entry.isNew).map((entry) => entry.ref),
      scope ?? [undefined],
    );
  } else {
    const plan = scope
      ? await makeLanguagePlan(source, now, { hasVoice, courseIds: scope })
      : await makePlan(source, now, { hasVoice });
    origins = plan.origins;
    // Пока есть долг паузы, новые карточки занимают только места, оставшиеся после повторений.
    const reserve = plan.pauseDebt ? 0 : Math.ceil(size / 2);
    const newOnes = plan.newRefs.slice(0, reserve);
    const reviews = shareReviews(plan.reviews, Math.max(size - newOnes.length, plan.reviews.length ? 1 : 0));
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
  const first = scope?.[0];
  const [cards, states, mates, languages, owners, sessionLanguage] = await Promise.all([
    source.cardsOf(wanted),
    source.statesOf(wanted),
    source.lessonMatesOf(wordIds),
    source.languagesOf(wanted),
    first ? source.coursesOf(wanted) : new Map<string, string>(),
    first ? source.courseLanguage(first) : undefined,
  ]);
  // Карточка вне уроков бывает у домашнего курса другого языка: варианты ей — из основного курса занятия, голос и
  // проверка — по языку занятия.
  const courseOf = (key: string) => {
    const own = owners.get(key);
    return own && languages.get(key) === sessionLanguage ? own : first;
  };
  const rank = (course: string | undefined) => {
    const index = scope?.indexOf(course ?? "") ?? -1;
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const groups = [...new Set([...cards.keys()].map(courseOf))].sort((a, b) => rank(a) - rank(b));
  const has = (course: string | undefined, kind: SessionCard["kind"]) =>
    [...cards].some(([key, card]) => card.kind === kind && courseOf(key) === course);
  // Пул фраз читается только когда в занятии есть фразы: словарная сессия не трогает таблицу фраз.
  const pools = new Map(
    await Promise.all(
      groups.map(
        async (course) =>
          [
            course,
            {
              words: !first || has(course, "word") ? await source.optionPool(OPTION_POOL, course) : [],
              phrases: has(course, "phrase") ? await source.phrasePool(OPTION_POOL, course) : [],
              sessionWords: [...cards].flatMap(([key, card]) =>
                card.kind === "word" && courseOf(key) === course ? [card.word] : [],
              ),
            },
          ] as const,
      ),
    ),
  );
  const id = `s-${now.getTime().toString(36)}-${Math.floor(random() * 1e6).toString(36)}`;
  const items: SessionItem[] = [];
  for (const entry of chosen) {
    const key = unitKey(entry.ref);
    const card = cards.get(key);
    if (!card) continue;
    const skills = entry.isNew ? emptySkills() : await source.skillsOf(card);
    const { words: pool, phrases, sessionWords } = pools.get(courseOf(key))!;
    const words = card.kind === "word" ? closeSources(card.word.id, mates, sessionWords, pool) : NO_WORDS;
    const language = sessionLanguage ?? languages.get(key) ?? DEFAULT_LANGUAGE;
    const exercise = exerciseFor(
      card,
      { words, phrases },
      skills,
      random,
      voiceFor(hasVoice, language),
      PROFILES[language],
    );
    if (!exercise) continue; // объективного упражнения нет: карточка остаётся для просмотра
    const origin = entry.isNew ? origins.get(key) : undefined;
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
    planDate: studyDay(now, source.timezone()),
    items: spaceSingleIntroduction(items),
    index: 0,
    status: "active",
    activeTimeMs: 0,
    introducedKeys: [],
    ...(first ? { courseId: first } : {}),
    ...(sessionLanguage ? { language: sessionLanguage } : {}),
  };
}

/**
 * Места повторений: вид с долей (`reviewShare`) занимает не больше неё, пока есть повторения других видов;
 * без них свободные места снова отдаются ему. Отложенные карточки вида идут в конец: занятие всё равно перемешивается.
 */
export function shareReviews<T extends { ref: LearningRef }>(reviews: T[], slots: number): T[] {
  const caps = new Map<string, number>();
  const taken: T[] = [];
  const deferred: T[] = [];
  for (const review of reviews) {
    if (taken.length >= slots) break;
    const share = KINDS[review.ref.kind].reviewShare;
    if (share === undefined) {
      taken.push(review);
      continue;
    }
    const used = caps.get(review.ref.kind) ?? 0;
    if (used < Math.floor(slots * share)) {
      caps.set(review.ref.kind, used + 1);
      taken.push(review);
    } else deferred.push(review);
  }
  return [...taken, ...deferred].slice(0, slots);
}

export function spaceSingleIntroduction(items: SessionItem[]): SessionItem[] {
  const fresh = items.filter((item) => item.isNew && !item.eventId && !item.retryOf);
  if (fresh.length !== 1 || items.some((item) => item.eventId)) return items;
  return [...items.filter((item) => item.id !== fresh[0].id), fresh[0]];
}
