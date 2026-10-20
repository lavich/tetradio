import { State, type Card } from "ts-fsrs";
import type { CatalogModule } from "../content/course";
import { isCheckable, KINDS, needsFacts, type AvailabilityContext, type CardFacts } from "./kinds";
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
  if (!card.last_review) return 0;
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
export interface DailyPlan {
  today: string;
  newRefs: LearningRef[];
  reviews: { ref: LearningRef; state: LearningState }[];
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
  const ahead = await source.dueStates(new Date(cutoff.getTime() - 1), courseId);
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
  // Слова и фразы с базы не удаляются, а слово проверяемо всегда: на большой базе план не читает их записи.
  const [dueLive, facts] = await Promise.all([
    source.liveKeys(dueRefs.filter((ref) => KINDS[ref.kind].vanishes)),
    source.factsOf([...candidates, ...dueRefs].filter(needsFacts)),
  ]);
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

  const askable = due.filter((state) => !KINDS[state.ref.kind].vanishes || dueLive.has(state.unitKey));
  for (const state of askable) if (!checkable(state.ref)) unavailable.push(state.ref);
  const debt = new Map<string, number>();
  if (debtBefore !== undefined)
    for (const state of askable)
      if (state.card.state === State.Review && new Date(state.card.due).getTime() < debtBefore)
        debt.set(state.unitKey, retrievability(state.card, now));
  const queue = (state: LearningState) => (debt.has(state.unitKey) ? 2 : stateRank(state.card));
  const reviews = askable
    .filter((state) => checkable(state.ref))
    .sort(
      (a, b) =>
        queue(a) - queue(b) ||
        (debt.get(a.unitKey) ?? 0) - (debt.get(b.unitKey) ?? 0) ||
        new Date(a.card.due).getTime() - new Date(b.card.due).getTime() ||
        a.unitKey.localeCompare(b.unitKey),
    )
    .map((s) => ({ ref: s.ref, state: s }));
  const pauseDebt = reviews.filter((review) => debt.has(review.state.unitKey)).length;

  return { today, newRefs, reviews, origins, unavailable, wakeAt, ...(pauseDebt ? { pauseDebt } : {}) };
}
