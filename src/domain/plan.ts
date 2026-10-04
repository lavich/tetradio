import { State, type Card } from "ts-fsrs";
import type { CatalogModule } from "../content/course";
import { unitKey } from "./refs";
import { localDay } from "./time";
import type { CardKind, LearningRef, LearningState, Lesson, LessonItem, Settings } from "./types";

/** Зрелость состояния для очередей: сперва то, что переучивается, потом разучиваемое, потом повторяемое. */
const stateRank = (card: Card) => (card.state === State.Relearning ? 0 : card.state === State.Learning ? 1 : 2);

export interface WordOrigin {
  lessonId: string;
  title: string;
}
/** `unavailable` — новые карточки без доступного объективного упражнения: видны отдельно, предел не расходуют. */
export interface DailyPlan {
  today: string;
  budget: number;
  introducedToday: number;
  newRefs: LearningRef[];
  reviews: { ref: LearningRef; state: LearningState }[];
  origins: Map<string, WordOrigin>;
  unavailable: LearningRef[];
}

/** Лёгкие признаки доступности проверки: для фразы — наличие перевода и файла аудио; слово проверяемо всегда. */
export interface CardFacts {
  kind: CardKind;
  hasTranslation?: boolean;
  hasAudio?: boolean;
}
export interface AvailabilityContext {
  hasVoice: boolean;
  phrasePool: number;
}
/**
 * Есть ли у карточки объективное упражнение. Фраза без перевода проверяется только аудированием,
 * для которого нужны голос или файл и четыре различных фразы в пуле. Агент не дописывает перевод для обхода.
 */
export const isCheckable = (facts: CardFacts, context: AvailabilityContext) =>
  facts.kind !== "phrase" ||
  !!facts.hasTranslation ||
  ((!!facts.hasAudio || context.hasVoice) && context.phrasePool >= 4);

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
  settings(): Promise<Settings>;
  newItemsPerDay(): Promise<number>;
  /** Пройденные уроки в порядке программы. */
  completedLessons(): Promise<PlanLesson[]>;
  /** Связи перечисленных уроков одной выборкой, в любом порядке. */
  itemsOf(lessonIds: string[]): Promise<LessonItem[]>;
  lessonRefs(lessonId: string): Promise<LearningRef[]>;
  introducedToday(today: string, timezone: string): Promise<number>;
  statesOf(refs: LearningRef[]): Promise<Map<string, LearningState>>;
  /** Ключи существующих карточек. */
  liveKeys(refs: LearningRef[]): Promise<Set<string>>;
  dueStates(now: Date): Promise<LearningState[]>;
  /** Признаки доступности упражнения для перечисленных карточек; тексты при этом не нужны. */
  factsOf(refs: LearningRef[]): Promise<Map<string, CardFacts>>;
  /** Число живых фраз: достаточность пула вариантов для аудирования фраз. */
  phraseCount(): Promise<number>;
}

export interface PlanOptions {
  hasVoice?: boolean;
}
export async function makePlan(source: PlanSource, now: Date, options: PlanOptions = {}): Promise<DailyPlan> {
  const settings = await source.settings();
  const timezone = settings.timezone;
  const today = localDay(now, timezone);
  const [lessons, limit, introducedToday, phrasePool] = await Promise.all([
    source.completedLessons(),
    source.newItemsPerDay(),
    source.introducedToday(today, timezone),
    source.phraseCount(),
  ]);
  const availability: AvailabilityContext = { hasVoice: !!options.hasVoice, phrasePool };
  const budget = Math.max(0, limit - introducedToday);

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
  const facts = await source.factsOf(candidates.filter((ref) => ref.kind === "phrase"));
  const fresh: LearningRef[] = [];
  const unavailable: LearningRef[] = [];
  for (const ref of candidates) {
    const info = ref.kind === "phrase" ? facts.get(unitKey(ref)) : undefined;
    if (ref.kind !== "phrase" || (info && isCheckable(info, availability))) fresh.push(ref);
    else unavailable.push(ref);
  }
  const newRefs = fresh.slice(0, budget);
  const titles = new Map(lessons.map((lesson) => [lesson.id, lesson.title]));
  const origins = new Map(
    newRefs.map((ref) => {
      const lessonId = firstLesson.get(unitKey(ref))!;
      return [unitKey(ref), { lessonId, title: titles.get(lessonId)! }];
    }),
  );

  const reviews = (await source.dueStates(now))
    .sort(
      (a, b) =>
        stateRank(a.card) - stateRank(b.card) ||
        new Date(a.card.due).getTime() - new Date(b.card.due).getTime() ||
        a.unitKey.localeCompare(b.unitKey),
    )
    .map((s) => ({ ref: s.ref, state: s }));

  return { today, budget, introducedToday, newRefs, reviews, origins, unavailable };
}
