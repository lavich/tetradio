import { State } from "ts-fsrs";
import { addDays, localDay, zonedStart } from "./learning";
import type { DaySummary } from "./skills";
import type { CardKind, ExerciseType, LearningRef, LearningState, SessionCard, Settings } from "./types";

export interface DayStat {
  date: string;
  answers: number;
  cards: number;
}
export interface SkillStat {
  type: ExerciseType;
  attempts: number;
  correct: number;
  rate: number | null;
}
/**
 * Порог «не даётся»: столько провалов у Anki по умолчанию переводит карточку в разряд проблемных.
 * Провалы берутся из состояния FSRS, а не пересчитываются по истории.
 */
export const LEECH_LAPSES = 8;
/** Список — сообщение пользователю, а не очередь работы: длинный перечень в него не помещается и не нужен. */
export const LEECH_LIMIT = 20;
export interface Leech {
  unitKey: string;
  ref: LearningRef;
  lapses: number;
  label: string;
}
/** Короткая подпись карточки для списков: у слова — написание, у фразы — текст, у пропуска — пропущенная форма. */
export const cardLabel = (card: SessionCard): string => (card.kind === "word" ? card.word.greek : card.phrase.text);
/** `totals.cards` — уникальные карточки любого вида с ответами; фразы и пропуски не выдаются за слова. */
export interface Progress {
  days: DayStat[];
  skills: SkillStat[];
  due: { today: number; tomorrow: number; week: number };
  groups: { fresh: number; learning: number; review: number; solid: number };
  leeches: Leech[];
  totals: { answers: number; cards: number; byKind: Record<CardKind, number> };
}

export interface StatsSource {
  settings(): Promise<Settings>;
  /** Дни периода с числом ответов и ключами карточек; источник сам сводит базу и локальные события. */
  daysBetween(fromDay: string, toDay: string): Promise<DaySummary[]>;
  /** Исходы последних ответов типа (старые → новые). */
  recentByType(type: ExerciseType, limit: number): Promise<boolean[]>;
  dueKeysBefore(instant: Date): Promise<string[]>;
  /** Ключи удалённых карточек всех видов. */
  deletedKeys(): Promise<Set<string>>;
  /** Число карточек всех видов, включая удалённые. */
  cardCount(): Promise<number>;
  eachState(visit: (state: LearningState) => void): Promise<void>;
  /** Подписи перечисленных карточек; читается только для отобранного списка, а не для всех состояний. */
  labelsOf(refs: LearningRef[]): Promise<Map<string, string>>;
  totals(): Promise<{ answers: number; cards: number; byKind: Record<CardKind, number> }>;
}

/**
 * Типы проверки в порядке показа; сводка по ним описывает форматы проверки, а не освоение грамматических тем.
 * Перечислены только предлагаемые сейчас типы: у снятых `recall` и `cloze` постоянная строка
 * «Ещё не проверяли» не описывала бы ни навык, ни историю. Их ответы остаются в общем числе и в разбивке по дням.
 */
export const SKILL_TYPES: ExerciseType[] = ["recognition", "assembly", "spelling", "listening", "comprehension"];
/** Статистика считается по записанным событиям, а не по показам экрана. */
export async function progress(source: StatsSource, now: Date): Promise<Progress> {
  const { timezone } = await source.settings();
  const today = localDay(now, timezone);
  const period = await source.daysBetween(addDays(today, -6), today);
  const days: DayStat[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    const day = period.find((entry) => entry.date === date);
    return { date, answers: day?.answers ?? 0, cards: day ? new Set(day.keys).size : 0 };
  });
  const skills: SkillStat[] = [];
  for (const type of SKILL_TYPES) {
    const recent = await source.recentByType(type, 10);
    const correct = recent.filter(Boolean).length;
    skills.push({ type, attempts: recent.length, correct, rate: recent.length ? correct / recent.length : null });
  }
  const deleted = await source.deletedKeys();
  // Срок сравниваем по календарной дате в зоне пользователя: «не позже дня» значит раньше начала следующего дня.
  const dueBefore = async (date: string) =>
    (await source.dueKeysBefore(zonedStart(addDays(date, 1), timezone))).filter((key) => !deleted.has(key)).length;
  const groups = { fresh: 0, learning: 0, review: 0, solid: 0 };
  let tracked = 0;
  const struggling: LearningState[] = [];
  await source.eachState((state) => {
    if (deleted.has(state.unitKey)) return;
    tracked++;
    if (state.card.lapses >= LEECH_LAPSES) struggling.push(state);
    if (state.card.state === State.Learning || state.card.state === State.Relearning) groups.learning++;
    else if (state.card.state === State.Review) groups[state.card.scheduled_days >= SOLID_DAYS ? "solid" : "review"]++;
  });
  groups.fresh = Math.max(0, (await source.cardCount()) - deleted.size - tracked);
  struggling.sort((a, b) => b.card.lapses - a.card.lapses || a.unitKey.localeCompare(b.unitKey));
  // Длина ограничивается до чтения подписей; состояние без карточки подписи не получит и в список не попадёт.
  const shown = struggling.slice(0, LEECH_LIMIT);
  const labels = shown.length ? await source.labelsOf(shown.map((state) => state.ref)) : new Map<string, string>();
  const leeches: Leech[] = shown.flatMap((state) => {
    const label = labels.get(state.unitKey);
    return label ? [{ unitKey: state.unitKey, ref: state.ref, lapses: state.card.lapses, label }] : [];
  });
  return {
    days,
    skills,
    due: {
      today: await dueBefore(today),
      tomorrow: await dueBefore(addDays(today, 1)),
      week: await dueBefore(addDays(today, 7)),
    },
    groups,
    leeches,
    totals: await source.totals(),
  };
}
/** Порог устойчивости: карточка с таким интервалом считается выученной и в тексте, и в полосе. Единый для всех видов. */
export const SOLID_DAYS = 21;
/**
 * Зрелость карточки — доля её интервала до порога устойчивости. Карточка без состояния даёт ноль,
 * с интервалом от порога — единицу. Нижняя граница в один день нужна введённой сегодня
 * карточке: иначе занятие не двигало бы полосу и выглядело бы бесполезным.
 */
export const wordMaturity = (state?: LearningState) =>
  state ? Math.min(1, Math.max(1, state.card.scheduled_days) / SOLID_DAYS) : 0;

export interface LessonProgress {
  solid: number;
  review: number;
  fresh: number;
  mature: number;
}
/**
 * Строка списка показывает урок с двух сторон: три группы карточек отвечают на вопрос «сколько карточек»
 * (устойчивые — Review с интервалом от порога, в повторении — любое другое состояние, новые — без состояния),
 * а `mature` — сумма зрелостей, из которой считается закрашенная доля полосы. Ключи — `unitKey` карточек.
 */
export function lessonProgress(keys: Iterable<string>, states: Map<string, LearningState>): LessonProgress {
  const groups: LessonProgress = { solid: 0, review: 0, fresh: 0, mature: 0 };
  for (const key of keys) {
    const state = states.get(key);
    if (!state) groups.fresh++;
    else if (state.card.state === State.Review && state.card.scheduled_days >= SOLID_DAYS) groups.solid++;
    else groups.review++;
    groups.mature += wordMaturity(state);
  }
  return groups;
}
/** Подписи всех типов проверки, включая снятые: строку для них никто не рисует, но старая история читается. */
export const SKILL_NAMES: Record<ExerciseType, string> = {
  recall: "Вспомнить слово",
  recognition: "Выбрать перевод",
  assembly: "Сборка из слогов",
  spelling: "Написание",
  listening: "Аудирование",
  comprehension: "Понимание на слух",
  cloze: "Заполнение пропуска",
};
