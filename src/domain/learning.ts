import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from "ts-fsrs";
import type { CatalogModule } from "../content/course";
import type { TextAnswerStatus } from "./text-answer";
import { unitKey } from "./refs";
import { emptySkills, summarizeEvents, type SkillSummary } from "./skills";
import { splitWriting } from "./syllables";
import {
  type CardKind,
  type ExerciseType,
  type LearningRef,
  type LearningState,
  type Lesson,
  type LessonItem,
  type Phrase,
  type ReviewEvent,
  type Session,
  type SessionCard,
  type SessionItem,
  type Settings,
  type Word,
} from "./types";

/**
 * Разброс интервалов включён: без него карточки, введённые в один день, возвращаются одной группой.
 * Случайности он не вносит — сид `ts-fsrs` строится из момента ответа, числа повторений и произведения
 * сложности на стабильность, поэтому для одной карточки, состояния и момента интервал воспроизводим.
 */
export const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

/** Зрелость состояния для очередей: сперва то, что переучивается, потом разучиваемое, потом повторяемое. */
const stateRank = (card: Card) => (card.state === State.Relearning ? 0 : card.state === State.Learning ? 1 : 2);

/** Календарный день в выбранной зоне, без деления миллисекунд на сутки. */
export function localDay(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const addDays = (day: string, count: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
export const formatDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
/** Момент начала календарного дня в зоне; переход летнего времени учитывается повторным расчётом смещения. */
export function zonedStart(day: string, timezone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const offset = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return (
      Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - date.getTime()
    );
  };
  const first = new Date(guess.getTime() - offset(guess));
  return new Date(guess.getTime() - offset(first));
}

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
  /** Ключи существующих и не удалённых карточек. */
  liveKeys(refs: LearningRef[]): Promise<Set<string>>;
  /** Удалённых карточек мало: их множество дешевле, чем проверять существование тысяч срочных повторений. */
  deletedKeys(): Promise<Set<string>>;
  dueStates(now: Date): Promise<LearningState[]>;
  /** Признаки доступности упражнения для перечисленных карточек; тексты при этом не нужны. */
  factsOf(refs: LearningRef[]): Promise<Map<string, CardFacts>>;
  /** Число живых фраз: достаточность пула вариантов для аудирования фраз. */
  phraseCount(): Promise<number>;
}
export interface SessionSource extends PlanSource {
  /** Полное содержимое только выбранных карточек. */
  cardsOf(refs: LearningRef[]): Promise<Map<string, SessionCard>>;
  /** Компактная сводка навыков карточки: синхронизированная база плюс локальные ответы после неё. */
  skillsOf(card: SessionCard): Promise<SkillSummary>;
  optionPool(want: number): Promise<Word[]>;
  /** Живые соседи слов по урокам в окне `LESSON_MATES_RADIUS` позиций, без самих слов. */
  lessonMatesOf(wordIds: string[]): Promise<Map<string, Word[]>>;
  /** Ограниченный пул фраз для вариантов ответа; читается, только если в сессии есть фразы. */
  phrasePool(want: number): Promise<Phrase[]>;
}
export const OPTION_POOL = 48;
/** Соседи по уроку — не дальше шести позиций в каждую сторону: близкие слова ограничены и в большом уроке. */
export const LESSON_MATES_RADIUS = 6;

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

  const [due, deleted] = await Promise.all([source.dueStates(now), source.deletedKeys()]);
  const reviews = due
    .filter((s) => !deleted.has(s.unitKey))
    .sort(
      (a, b) =>
        stateRank(a.card) - stateRank(b.card) ||
        new Date(a.card.due).getTime() - new Date(b.card.due).getTime() ||
        a.unitKey.localeCompare(b.unitKey),
    )
    .map((s) => ({ ref: s.ref, state: s }));

  return { today, budget, introducedToday, newRefs, reviews, origins, unavailable };
}

const ORDER: ExerciseType[] = ["recognition", "assembly", "spelling", "listening", "comprehension"];
/**
 * `canSpell` — есть перевод, по которому пишут; у слов всегда, у фраз без перевода — нет.
 * `canListen` — аудирование доступно само по себе (у фраз варианты аудирования отделены от вариантов узнавания);
 * без него аудирование требует звука и вариантов узнавания, как у слов.
 */
export interface SkillContext {
  hasAudio?: boolean;
  hasOptions?: boolean;
  canAssemble?: boolean;
  canSpell?: boolean;
  canListen?: boolean;
  canComprehend?: boolean;
}

/**
 * Написание открывается, когда после последней ошибки в нём набрана хотя бы одна успешная сборка.
 * Сборка показывает все буквы слова и проверяет их порядок, а не продукцию: дольше держать письмо
 * закрытым значит не проверять продукцию вовсе — при интервалах FSRS вторая сборка выпадает через месяц.
 */
export const spellingUnlockedFor = (skills: SkillSummary) => skills.cleanAssemblies >= 1;
/**
 * Понимание на слух открывается после первого верного узнавания: пока значение не связано с формой,
 * выбор из четырёх переводов к незнакомому звуку — угадайка. Ошибка условие не сбрасывает: навык уже открыт,
 * а слабость видна планировщику по доле ошибок.
 */
export const comprehensionUnlockedFor = (skills: SkillSummary) => !!skills.types.recognition?.recent.some(Boolean);
export function spellingUnlocked(unitKey: string, events: ReviewEvent[]): boolean {
  return spellingUnlockedFor(summarizeEvents(unitKey, events));
}

/** Доступные упражнения в порядке предпочтения; пусто — карточку нечем объективно проверить. */
export function availableTypes(skills: SkillSummary, context: SkillContext = {}): ExerciseType[] {
  const {
    hasAudio = false,
    hasOptions = true,
    canAssemble = false,
    canSpell = true,
    canListen = hasAudio && hasOptions,
    canComprehend = false,
  } = context;
  return ORDER.filter(
    (type) =>
      (type !== "listening" || canListen) &&
      (type !== "comprehension" || (canComprehend && hasOptions && canSpell && comprehensionUnlockedFor(skills))) &&
      (type !== "recognition" || (hasOptions && canSpell)) &&
      (type !== "assembly" || canAssemble) &&
      (type !== "spelling" || (canSpell && (!canAssemble || spellingUnlockedFor(skills)))),
  );
}
/** Эвристика выбора упражнения по последним ответам, а не оценка вероятности памяти. */
export function chooseTypeFor(skills: SkillSummary, context: SkillContext = {}): ExerciseType {
  const available = availableTypes(skills, context);
  if (!available.length) return "spelling";
  const [beforeLast, last] = skills.lastTypes.length === 2 ? skills.lastTypes : [undefined, skills.lastTypes[0]];
  const repeated = last && beforeLast && last === beforeLast ? last : null;
  const allowed = available.filter((type) => type !== repeated);
  const pool = allowed.length ? allowed : available;
  const untested = pool.find((type) => !skills.types[type]);
  if (untested) return untested;
  const score = (type: ExerciseType) => {
    const recent = skills.types[type]!;
    return { rate: recent.recent.filter(Boolean).length / recent.recent.length, at: recent.lastAt };
  };
  return pool.slice(1).reduce((best, type) => {
    const a = score(best),
      b = score(type);
    return b.rate < a.rate || (b.rate === a.rate && b.at < a.at) ? type : best;
  }, pool[0]);
}
/** Совместимая форма: история карточки сворачивается в сводку и даёт тот же выбор. */
export function chooseType(unitKey: string, events: ReviewEvent[], context: SkillContext = {}): ExerciseType {
  return chooseTypeFor(summarizeEvents(unitKey, events), context);
}

/**
 * Задания с готовыми вариантами: только у них длительность ответа говорит о лёгкости вспоминания.
 * В сборке, написании и пропуске она определяется длиной ответа и скоростью набора, поэтому там не читается.
 */
export const FAST_TYPES: readonly ExerciseType[] = ["recognition", "listening", "comprehension"];
/**
 * Порог быстрого ответа. Общий для трёх типов, хотя у аудирования и понимания на слух в него входит
 * воспроизведение: перекос сознательно в консервативную сторону — `Easy` там выпадает реже,
 * и ни одна карточка не получает завышенный интервал из-за короткого аудио.
 */
export const FAST_ANSWER_MS = 3500;
/**
 * Оценка объективного ответа. `status` отвечает на вопрос «насколько подвинуть срок», а поле `correct`
 * события — на вопрос «что показать и чему учить дальше»: «Почти» остаётся ошибкой навыка и поводом
 * для дополнительной попытки, но полного сброса интервала не заслуживает.
 */
export function gradeFor(status: TextAnswerStatus, type: ExerciseType, responseTimeMs: number): Grade {
  if (status === "almost") return Rating.Hard;
  if (status !== "correct") return Rating.Again;
  return FAST_TYPES.includes(type) && responseTimeMs < FAST_ANSWER_MS ? Rating.Easy : Rating.Good;
}

/** Practice сюда не попадает: ручная тренировка не должна двигать интервалы. */
export function nextState(state: LearningState | undefined, ref: LearningRef, rating: Grade, now: Date): LearningState {
  const card: Card = state
    ? {
        ...state.card,
        due: new Date(state.card.due),
        last_review: state.card.last_review ? new Date(state.card.last_review) : undefined,
      }
    : createEmptyCard(now);
  const next = scheduler.next(card, now, rating).card;
  return {
    unitKey: unitKey(ref),
    ref,
    card: next,
    introducedAt: state?.introducedAt ?? now.toISOString(),
    version: (state?.version ?? 0) + 1,
  };
}

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
const hasArticle = (word: Word) => !!splitWriting(word.greek).article;
/**
 * Три различных неверных ответа или `[]`, если их меньше трёх. Форма (есть ли артикль) важнее потолка
 * близких слов, потолок важнее источника: близкие той же формы до потолка → словарь той же формы →
 * близкие той же формы сверх потолка → то же для другой формы. Внутри группы порядок случайный.
 */
export function distractorsFor(word: Word, sources: WordSources, type: ExerciseType, random: () => number): string[] {
  const key = (w: Word) => (type === "recognition" ? w.russian : w.greek);
  const own = normAnswer(key(word));
  const form = hasArticle(word);
  const closeIds = new Set(sources.close.map((w) => w.id));
  // Ранг: 0 — близкие той же формы, 1 — словарь той же формы, 2 и 3 — то же другой формы.
  // Совпадающий ответ входит во все свои группы и берётся той, до которой очередь дошла раньше:
  // близкий той же формы сверх потолка уступает словарю той же формы, а близкий другой формы — ему же.
  const groups = new Map<string, (string | undefined)[]>();
  const consider = (w: Word, close: boolean) => {
    const value = key(w);
    const norm = value && normAnswer(value);
    if (w.id === word.id || !norm || norm === own) return;
    const rank = (hasArticle(w) === form ? 0 : 2) + (close ? 0 : 1);
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
export function optionsFor(word: Word, sources: WordSources, type: ExerciseType, random: () => number): string[] {
  const wrong = distractorsFor(word, sources, type, random);
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

export interface SessionInput {
  source: SessionSource;
  now: Date;
  random?: () => number;
  mode?: "scheduled" | "practice";
  refs?: LearningRef[];
  hasVoice?: boolean;
}
export async function makeSession({
  source,
  now,
  random = Math.random,
  mode = "scheduled",
  refs,
  hasVoice = false,
}: SessionInput): Promise<Session> {
  const plan = await makePlan(source, now, { hasVoice });
  const settings = await source.settings();
  const size = Math.max(2, settings.sessionSize);
  let chosen: { ref: LearningRef; isNew: boolean }[];
  if (refs) {
    const live = await source.liveKeys(refs);
    const kept = refs.filter((ref) => live.has(unitKey(ref)));
    const states = await source.statesOf(kept);
    chosen = kept.map((ref) => ({ ref, isNew: !states.has(unitKey(ref)) }));
  } else {
    const reserve = Math.min(plan.budget, Math.ceil(size / 2));
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
  const [cards, states, pool, mates] = await Promise.all([
    source.cardsOf(wanted),
    source.statesOf(wanted),
    source.optionPool(OPTION_POOL),
    source.lessonMatesOf(wordIds),
  ]);
  const sessionWords = [...cards.values()].flatMap((card) => (card.kind === "word" ? [card.word] : []));
  // Пул фраз читается только когда в занятии есть фразы: словарная сессия не трогает таблицу фраз.
  const phrases = [...cards.values()].some((card) => card.kind === "phrase")
    ? await source.phrasePool(OPTION_POOL)
    : [];
  const id = `s-${now.getTime().toString(36)}-${Math.floor(random() * 1e6).toString(36)}`;
  const items: SessionItem[] = [];
  for (const entry of chosen) {
    const key = unitKey(entry.ref);
    const card = cards.get(key);
    if (!card) continue;
    const skills = entry.isNew ? emptySkills() : await source.skillsOf(card);
    const words = card.kind === "word" ? closeSources(card.word.id, mates, sessionWords, pool) : NO_WORDS;
    const exercise = exerciseFor(card, { words, phrases }, skills, random, hasVoice);
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
    objectiveVersion: 1,
  };
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
/**
 * Ступени вниз после ошибки: попытка сразу после показанного ответа должна быть поддержанной,
 * а не повторным экзаменом. Сборка даёт слоги, узнавание — готовые ответы; ниже узнавания ступеней нет.
 */
const EASIER: Partial<Record<ExerciseType, ExerciseType[]>> = {
  spelling: ["assembly", "recognition"],
  assembly: ["recognition"],
  comprehension: ["recognition"],
};
/** Есть ли под заданием ступень: пул вариантов читается только ради неё. */
export const hasEasierStep = (type: ExerciseType) => !!EASIER[type];
/**
 * Упражнение дополнительной попытки: ближайшая доступная ступень проще провалённой.
 * `null` — ступени нет (узнавание, аудирование, нехватка слогов или вариантов): попытка повторяет то же задание.
 * Условие открытия написания здесь не действует: попытка идёт вниз по ступеням, а не вверх.
 */
export function easierExercise(
  card: SessionCard,
  type: ExerciseType,
  pools: OptionPools,
  random: () => number = Math.random,
): Pick<SessionItem, "type" | "options"> | null {
  for (const step of EASIER[type] ?? []) {
    if (step === "assembly") {
      const exercise = card.kind === "word" ? assemblyExercise(card.word, random) : null;
      if (exercise) return exercise;
      continue;
    }
    const options =
      card.kind === "word"
        ? optionsFor(card.word, pools.words, "recognition", random)
        : phraseOptionsFor(card.phrase, pools.phrases, "recognition", random);
    if (options.length === 4) return { type: "recognition", options };
  }
  return null;
}
/** Сборка слова: `null` — слогов меньше двух. Артикль ложится в пул обычной плиткой и ставится наравне со слогами. */
function assemblyExercise(word: Word, random: () => number): Pick<SessionItem, "type" | "options"> | null {
  const writing = splitWriting(word.greek);
  const parts = writing.syllables;
  if (parts.length < 2) return null;
  // Перемешивается весь пул целиком: отсюда и детерминированный поток random для остальных заданий, и порядок, отличный от правильного.
  return { type: "assembly", options: shuffleTiles(writing.article ? [writing.article, ...parts] : parts, random) };
}
/** Упражнение для карточки любого вида; `null` — фразу нечем объективно проверить. */
export function exerciseFor(
  card: SessionCard,
  pools: ExercisePools,
  skills: SkillSummary,
  random: () => number,
  hasVoice: boolean,
): Pick<SessionItem, "type" | "options"> | null {
  if (card.kind === "word") return objectiveExercise(card.word, pools.words, skills, random, hasVoice);
  return phraseExercise(card.phrase, pools.phrases, skills, random, hasVoice);
}

/** Виды упражнений слова, которые пользователь может выбрать сам. */
export const WORD_EXERCISES = ["recognition", "assembly", "spelling", "listening", "comprehension"] as const;
export type WordExerciseType = (typeof WORD_EXERCISES)[number];
export type ExerciseAvailability = { available: true } | { available: false; reason: string };
export const NO_SOUND = "Нужен звук: у слова нет файла, а на устройстве нет греческого голоса";
export const FEW_OPTIONS = "Для вариантов не хватает слов в словаре";
export const ONE_SYLLABLE = "В слове один слог — собирать нечего";

/**
 * Данные слова для упражнений: варианты узнавания и аудирования, число слогов, есть ли звук.
 * Варианты подбираются в этом порядке: от него зависит поток `random` и воспроизводимость занятия.
 */
function wordFacts(word: Word, sources: WordSources, random: () => number, hasVoice: boolean) {
  return {
    syllables: splitWriting(word.greek).syllables.length,
    recognition: optionsFor(word, sources, "recognition", random),
    listening: optionsFor(word, sources, "listening", random),
    sounds: !!word.audioAssetId || hasVoice,
  };
}
type WordFacts = ReturnType<typeof wordFacts>;
/** Условия данных — общие для выбора системой и выбора пользователем; условия навыков добавляет только `chooseTypeFor`. */
const contextOf = (facts: WordFacts): SkillContext => ({
  hasAudio: facts.sounds && facts.listening.length === 4,
  hasOptions: facts.recognition.length === 4,
  canAssemble: facts.syllables >= 2,
  canComprehend: facts.sounds && facts.recognition.length === 4,
});
function availabilityOf(facts: WordFacts): Record<WordExerciseType, ExerciseAvailability> {
  const context = contextOf(facts);
  const when = (ok: boolean | undefined, reason: string): ExerciseAvailability =>
    ok ? { available: true } : { available: false, reason };
  return {
    recognition: when(context.hasOptions, FEW_OPTIONS),
    assembly: when(context.canAssemble, ONE_SYLLABLE),
    spelling: { available: true },
    listening: facts.sounds ? when(context.hasAudio, FEW_OPTIONS) : when(false, NO_SOUND),
    comprehension: facts.sounds ? when(context.canComprehend, FEW_OPTIONS) : when(false, NO_SOUND),
  };
}
/** Какие упражнения слово может получить по выбору пользователя: только данные слова и устройства, без навыков. */
export function wordExerciseOptions(
  word: Word,
  sources: WordSources,
  hasVoice: boolean,
): Record<WordExerciseType, ExerciseAvailability> {
  return availabilityOf(wordFacts(word, sources, Math.random, hasVoice));
}
/** Упражнение выбранного вида без учёта навыков; `null` — вид слову недоступен. */
export function buildWordExercise(
  word: Word,
  type: WordExerciseType,
  sources: WordSources,
  random: () => number = Math.random,
  hasVoice = false,
): Pick<SessionItem, "type" | "options"> | null {
  const facts = wordFacts(word, sources, random, hasVoice);
  if (!availabilityOf(facts)[type].available) return null;
  if (type === "assembly") return assemblyExercise(word, random);
  return {
    type,
    options: type === "listening" ? facts.listening : type === "spelling" ? [] : facts.recognition,
  };
}

/** Варианты проверяем по уникальным ответам, а не только по размеру словаря. */
export function objectiveExercise(
  word: Word,
  sources: WordSources,
  skills: SkillSummary = emptySkills(),
  random: () => number = Math.random,
  hasVoice = false,
): Pick<SessionItem, "type" | "options"> {
  const facts = wordFacts(word, sources, random, hasVoice);
  const type = chooseTypeFor(skills, contextOf(facts));
  if (type === "assembly") {
    const exercise = assemblyExercise(word, random);
    if (exercise) return exercise;
  }
  return {
    type,
    options:
      type === "recognition" || type === "comprehension"
        ? facts.recognition
        : type === "listening"
          ? facts.listening
          : [],
  };
}
/**
 * Фраза: узнавание и написание при переводе, аудирование при голосе или файле и четырёх различных фразах.
 * Слоговой сборки и её условий нет; при недостатке вариантов — написание. Без единого доступного упражнения — `null`.
 */
export function phraseExercise(
  phrase: Phrase,
  pool: Phrase[],
  skills: SkillSummary = emptySkills(),
  random: () => number = Math.random,
  hasVoice = false,
): Pick<SessionItem, "type" | "options"> | null {
  const recognition = phraseOptionsFor(phrase, pool, "recognition", random);
  const listening = phraseOptionsFor(phrase, pool, "listening", random);
  const sounds = !!phrase.audioAssetId || hasVoice;
  const canListen = sounds && listening.length === 4;
  const context: SkillContext = {
    hasAudio: canListen,
    canListen,
    hasOptions: recognition.length === 4,
    canAssemble: false,
    canSpell: !!phrase.translation,
    canComprehend: sounds && recognition.length === 4,
  };
  if (!availableTypes(skills, context).length) return null;
  const type = chooseTypeFor(skills, context);
  return {
    type,
    options: type === "recognition" || type === "comprehension" ? recognition : type === "listening" ? listening : [],
  };
}

export function spaceSingleIntroduction(items: SessionItem[]): SessionItem[] {
  const fresh = items.filter((item) => item.isNew && !item.eventId && !item.retryOf);
  if (fresh.length !== 1 || items.some((item) => item.eventId)) return items;
  return [...items.filter((item) => item.id !== fresh[0].id), fresh[0]];
}
