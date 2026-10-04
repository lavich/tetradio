import { summarizeEvents, type SkillSummary } from "./skills";
import type { ExerciseType, ReviewEvent } from "./types";

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
