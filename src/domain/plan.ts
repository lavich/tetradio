import { State, type Card } from "ts-fsrs";
import type { CatalogModule } from "../content/course";
import { isCheckable, isPlanned, needsFacts, type AvailabilityContext, type CardFacts } from "./kinds";
import type { Voices } from "./language";
import { unitKey } from "./refs";
import { scheduler } from "./scheduling";
import { addDays, DAY_STARTS_AT, studyDay, zonedStart } from "./time";
import type { LearningRef, LearningState, Lesson, LessonItem } from "./types";

export { DAY_STARTS_AT };
/** Конец учебного дня `now`: срок до него — сегодняшний. */
export const reviewCutoff = (now: Date, timezone: string): Date =>
  zonedStart(addDays(studyDay(now, timezone), 1), timezone, DAY_STARTS_AT);
/** Повторение в днях ждёт своего дня, а короткий шаг изучения — точного момента, иначе 10 минут сжались бы в ноль. */
export function isDue(card: Pick<Card, "state" | "due">, now: Date, cutoff: Date): boolean {
  const due = new Date(card.due).getTime();
  return card.state === State.Review ? due < cutoff.getTime() : due <= now.getTime();
}

/** Зрелость состояния для очередей: сперва то, что переучивается, потом разучиваемое, потом повторяемое. */
const stateRank = (card: Card) => (card.state === State.Relearning ? 0 : card.state === State.Learning ? 1 : 3);
/** Карточка без даты последнего повторения (старые снимки) для FSRS невалидна: считаем её забытой. */
function retrievability(card: Card, now: Date): number {
  if (!card.last_review || Number.isNaN(new Date(card.last_review).getTime())) return 0;
  try {
    return scheduler.get_retrievability(card, now, false);
  } catch {
    return 0;
  }
}

export interface WordOrigin {
  lessonId: string;
  title: string;
}
/**
 * `unavailable` — карточки без доступного объективного упражнения, новые и со сроком: видны отдельно.
 * Карточка со сроком, содержимого которой на устройстве нет, в план не входит вовсе; её состояние остаётся.
 */
export interface PlanReview {
  ref: LearningRef;
  state: LearningState;
  /** Вероятность вспомнить на момент плана — только у повторения долга паузы. */
  debt?: number;
}
const queueOf = (review: PlanReview) => (review.debt !== undefined ? 2 : stateRank(review.state.card));
/** Порядок повторений: переучиваемые, разучиваемые, долг паузы от самых забытых, остальные по сроку. */
export const compareReviews = (a: PlanReview, b: PlanReview) =>
  queueOf(a) - queueOf(b) ||
  (a.debt ?? 0) - (b.debt ?? 0) ||
  new Date(a.state.card.due).getTime() - new Date(b.state.card.due).getTime() ||
  a.state.unitKey.localeCompare(b.state.unitKey);
export interface DailyPlan {
  today: string;
  newRefs: LearningRef[];
  reviews: PlanReview[];
  origins: Map<string, WordOrigin>;
  unavailable: LearningRef[];
  /** Когда план может измениться сам: срок ближайшей карточки обучения или конец учебного дня. */
  wakeAt: Date;
  /** Повторений долга паузы среди `reviews`; без долга поля нет. */
  pauseDebt?: number;
}

export interface PlanLesson {
  id: string;
  title: string;
}
type ProgrammeModule = Pick<CatalogModule, "number" | "lessonIds" | "checkpointId" | "reviewIds">;
/**
 * Порядок программы: модуль по номеру, в нём уроки, контрольная и повторение.
 * Уроки вне модулей идут после, по месту в каталоге, затем по id.
 */
export function programmeOrder(
  lessons: Lesson[],
  modules: ProgrammeModule[],
  position: (lessonId: string) => number | undefined,
): PlanLesson[] {
  const programme = new Map<string, number>();
  for (const module of [...modules].sort((a, b) => a.number - b.number))
    for (const id of [
      ...module.lessonIds,
      ...(module.checkpointId ? [module.checkpointId] : []),
      ...(module.reviewIds ?? []),
    ])
      if (!programme.has(id)) programme.set(id, programme.size);
  const rank = (id: string) => programme.get(id) ?? programme.size + (position(id) ?? Number.MAX_SAFE_INTEGER);
  return [...lessons]
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
    .map((lesson) => ({ id: lesson.id, title: lesson.title }));
}
/** Источник данных планировщика: ограниченные выборки вместо полного снимка. Все карты ключуются `unitKey`. */
export interface PlanSource {
  /** Часовой пояс, по которому считается «сегодня». */
  timezone(): string;
  /** Пройденные и начатые уроки курса в порядке его программы; без курса — всех курсов. */
  studiedLessons(courseId?: string): Promise<PlanLesson[]>;
  /** Связи перечисленных уроков одной выборкой, в любом порядке. */
  itemsOf(lessonIds: string[]): Promise<LessonItem[]>;
  lessonRefs(lessonId: string): Promise<LearningRef[]>;
  statesOf(refs: LearningRef[]): Promise<Map<string, LearningState>>;
  /** Ключи существующих карточек. */
  liveKeys(refs: LearningRef[]): Promise<Set<string>>;
  /** Состояния со сроком не позже `until`; с курсом — только карточки этого курса. */
  dueStates(until: Date, courseId?: string): Promise<LearningState[]>;
  /** То же для нескольких курсов одним проходом по сроку: план языка не читает индекс срока на каждый курс. */
  dueStatesOf?(until: Date, courseIds: string[]): Promise<Map<string, LearningState[]>>;
  /** Признаки доступности упражнения для перечисленных карточек; тексты при этом не нужны. */
  factsOf(refs: LearningRef[]): Promise<Map<string, CardFacts>>;
  /** Число живых фраз курса: достаточность пула вариантов для аудирования фраз. */
  phraseCount(courseId?: string): Promise<number>;
  /** Пауза курса: `pausedAt` — курс на паузе, `resumedAt` — когда возвращён. */
  pauseOf?(courseId: string): Promise<PlanPause | undefined>;
}
export interface PlanPause {
  pausedAt: string | null;
  resumedAt: string | null;
}

export interface PlanOptions {
  hasVoice?: Voices;
  /** План курса: без него — по всем курсам сразу. */
  courseId?: string;
}
export async function makePlan(source: PlanSource, now: Date, options: PlanOptions = {}): Promise<DailyPlan> {
  const timezone = source.timezone();
  const today = studyDay(now, timezone);
  const { courseId } = options;
  const pause = courseId ? await source.pauseOf?.(courseId) : undefined;
  if (pause?.pausedAt)
    return {
      today,
      newRefs: [],
      reviews: [],
      origins: new Map(),
      unavailable: [],
      wakeAt: reviewCutoff(now, timezone),
    };
  // Долг паузы — повторения со сроком раньше дня возврата: они идут от самых забытых, сроки не сдвигаются.
  const debtBefore = pause?.resumedAt
    ? zonedStart(studyDay(new Date(pause.resumedAt), timezone), timezone, DAY_STARTS_AT).getTime()
    : undefined;
  const [lessons, phrasePool] = await Promise.all([source.studiedLessons(courseId), source.phraseCount(courseId)]);
  const availability: AvailabilityContext = { hasVoice: options.hasVoice ?? false, phrasePool };

  const rank = new Map(lessons.map((lesson, index) => [lesson.id, index]));
  const items = (await source.itemsOf(lessons.map((lesson) => lesson.id))).sort(
    (a, b) =>
      rank.get(a.lessonId)! - rank.get(b.lessonId)! || a.position - b.position || a.unitKey.localeCompare(b.unitKey),
  );
  const firstLesson = new Map<string, string>();
  const refs: LearningRef[] = [];
  for (const item of items) {
    if (firstLesson.has(item.unitKey)) continue;
    firstLesson.set(item.unitKey, item.lessonId);
    refs.push(item.ref);
  }
  const [live, states] = await Promise.all([source.liveKeys(refs), source.statesOf(refs)]);
  const candidates = refs.filter((ref) => live.has(unitKey(ref)) && !states.has(unitKey(ref)));
  const cutoff = reviewCutoff(now, source.timezone());
  const ahead = (await source.dueStates(new Date(cutoff.getTime() - 1), courseId)).filter((state) =>
    isPlanned(state.ref),
  );
  const due = ahead.filter((state) => isDue(state.card, now, cutoff));
  const wakeAt = new Date(
    Math.min(
      cutoff.getTime(),
      ...ahead
        .filter((state) => state.card.state !== State.Review && !isDue(state.card, now, cutoff))
        .map((state) => new Date(state.card.due).getTime())
        .filter(Number.isFinite),
    ),
  );
  const dueRefs = due.map((state) => state.ref);
  // Слово проверяемо всегда: на большой базе план не читает их записи.
  const facts = await source.factsOf([...candidates, ...dueRefs].filter(needsFacts));
  const checkable = (ref: LearningRef) => {
    if (!needsFacts(ref)) return true;
    const info = facts.get(unitKey(ref));
    return !!info && isCheckable(info, availability);
  };
  const newRefs: LearningRef[] = [];
  const unavailable: LearningRef[] = [];
  for (const ref of candidates) (checkable(ref) ? newRefs : unavailable).push(ref);
  const titles = new Map(lessons.map((lesson) => [lesson.id, lesson.title]));
  const origins = new Map(
    newRefs.map((ref) => {
      const lessonId = firstLesson.get(unitKey(ref))!;
      return [unitKey(ref), { lessonId, title: titles.get(lessonId)! }];
    }),
  );

  for (const state of due) if (!checkable(state.ref)) unavailable.push(state.ref);
  const debt = new Map<string, number>();
  if (debtBefore !== undefined)
    for (const state of due)
      if (state.card.state === State.Review && new Date(state.card.due).getTime() < debtBefore)
        debt.set(state.unitKey, retrievability(state.card, now));
  const reviews = due
    .filter((state) => checkable(state.ref))
    .map((state): PlanReview => {
      const forgotten = debt.get(state.unitKey);
      return { ref: state.ref, state, ...(forgotten === undefined ? {} : { debt: forgotten }) };
    })
    .sort(compareReviews);
  const pauseDebt = reviews.filter((review) => review.debt !== undefined).length;

  return { today, newRefs, reviews, origins, unavailable, wakeAt, ...(pauseDebt ? { pauseDebt } : {}) };
}

export interface LanguagePlanOptions {
  hasVoice?: Voices;
  /** Курсы языка; первый начинает очередь новых карточек. */
  courseIds: string[];
}
/**
 * План языка — планы его курсов, слитые в один: пауза, долг, программа и доступность упражнений остаются правилами
 * курса. Повторения — в общем порядке, новые — по одной карточке каждого курса по очереди.
 */
export async function makeLanguagePlan(
  source: PlanSource,
  now: Date,
  { hasVoice, courseIds }: LanguagePlanOptions,
): Promise<DailyPlan> {
  if (courseIds.length === 1) return makePlan(source, now, { hasVoice, courseId: courseIds[0] });
  const shared = sharedDue(source, courseIds);
  const plans = await Promise.all(courseIds.map((courseId) => makePlan(shared, now, { hasVoice, courseId })));
  const timezone = source.timezone();
  const seen = new Set<string>();
  const once = (ref: LearningRef) => !seen.has(unitKey(ref)) && !!seen.add(unitKey(ref));
  const newRefs: LearningRef[] = [];
  for (let index = 0; plans.some((plan) => index < plan.newRefs.length); index++)
    for (const plan of plans)
      if (index < plan.newRefs.length && once(plan.newRefs[index])) newRefs.push(plan.newRefs[index]);
  const reviews = plans
    .flatMap((plan) => plan.reviews)
    .sort(compareReviews)
    .filter((review) => once(review.ref));
  const pauseDebt = reviews.filter((review) => review.debt !== undefined).length;
  return {
    today: studyDay(now, timezone),
    newRefs,
    reviews,
    origins: new Map(plans.flatMap((plan) => [...plan.origins])),
    unavailable: plans.flatMap((plan) => plan.unavailable).filter(once),
    wakeAt: new Date(Math.min(reviewCutoff(now, timezone).getTime(), ...plans.map((plan) => plan.wakeAt.getTime()))),
    ...(pauseDebt ? { pauseDebt } : {}),
  };
}
function sharedDue(source: PlanSource, courseIds: string[]): PlanSource {
  if (!source.dueStatesOf) return source;
  const read = new Map<number, Promise<Map<string, LearningState[]>>>();
  return {
    ...source,
    dueStates: async (until, courseId) => {
      if (!courseId) return source.dueStates(until);
      if (!read.has(until.getTime())) read.set(until.getTime(), source.dueStatesOf!(until, courseIds));
      return (await read.get(until.getTime())!).get(courseId) ?? [];
    },
  };
}

/** Источники новых карточек из выбранных: первый пройденный урок карточки в порядке программы её курса. */
export async function originsOf(
  source: PlanSource,
  refs: LearningRef[],
  courseIds: (string | undefined)[],
): Promise<Map<string, WordOrigin>> {
  const wanted = new Set(refs.map(unitKey));
  const origins = new Map<string, WordOrigin>();
  for (const lessons of await Promise.all(courseIds.map((courseId) => source.studiedLessons(courseId)))) {
    const rank = new Map(lessons.map((lesson, index) => [lesson.id, index]));
    const titles = new Map(lessons.map((lesson) => [lesson.id, lesson.title]));
    const items = (await source.itemsOf(lessons.map((lesson) => lesson.id)))
      .filter((item) => wanted.has(item.unitKey))
      .sort(
        (a, b) =>
          rank.get(a.lessonId)! - rank.get(b.lessonId)! ||
          a.position - b.position ||
          a.unitKey.localeCompare(b.unitKey),
      );
    for (const item of items)
      if (!origins.has(item.unitKey))
        origins.set(item.unitKey, { lessonId: item.lessonId, title: titles.get(item.lessonId)! });
  }
  return origins;
}
