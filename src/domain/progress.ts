import type { Skill } from "../content/course";

/** Календарь курса из docs/curriculum.md: старт и контрольные точки после модулей; отставание считается от него. */
export const COURSE_START = "2026-10-05";
export const CHECKPOINTS = [
  { label: "K1", title: "Контрольная A1", afterModule: 8, date: "2026-12-13" },
  { label: "M1", title: "Пробник M1", afterModule: 15, date: "2027-02-13" },
  { label: "M2", title: "Пробник M2", afterModule: 20, date: "2027-03-29" },
  { label: "M3", title: "Пробник M3", afterModule: 24, date: "2027-05-02" },
] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

const DAY = 86400000;
const days = (from: string, to: string) => (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY;

export interface ModuleLoad {
  number: number;
  /** Все уроки модуля вместе с контрольной точкой и повторением после неё. */
  lessons: number;
  done: number;
}
export interface Pace {
  done: number;
  total: number;
  /** Сколько уроков по календарю должно быть пройдено к сегодняшнему дню. */
  planned: number;
  /** Отставание в неделях по темпу текущего отрезка календаря; 0 — по плану или впереди. */
  lagWeeks: number;
  next: { checkpoint: Checkpoint; remaining: number; perWeek: number } | null;
  /** Уроков в неделю за последние четыре недели или с первого пройденного урока; меньше недели истории — `null`. */
  recentPerWeek: number | null;
}

/**
 * Темп против календаря курса: между контрольными точками план растёт равномерно, к дате точки должны быть
 * пройдены все уроки модулей до неё. Единица — урок, а не занятие: занятие курса — один урок модуля.
 */
export function coursePace(modules: ModuleLoad[], today: string, completedDays: string[]): Pace {
  const total = modules.reduce((sum, module) => sum + module.lessons, 0);
  const done = modules.reduce((sum, module) => sum + module.done, 0);
  const upTo = (number: number) =>
    modules.filter((module) => module.number <= number).reduce((sum, module) => sum + module.lessons, 0);
  let from = { date: COURSE_START, lessons: 0 };
  let planned = total;
  let rate = 0;
  for (const point of CHECKPOINTS) {
    const to = { date: point.date, lessons: upTo(point.afterModule) };
    const span = days(from.date, to.date);
    rate = span > 0 ? ((to.lessons - from.lessons) / span) * 7 : 0;
    if (today <= to.date) {
      const share = span > 0 ? Math.max(0, days(from.date, today)) / span : 1;
      planned = Math.round(from.lessons + (to.lessons - from.lessons) * share);
      break;
    }
    from = to;
  }
  const lag = Math.max(0, planned - done);
  const point = CHECKPOINTS.find((item) => today <= item.date && done < upTo(item.afterModule));
  const weeksLeft = point ? Math.max(days(today, point.date) / 7, 1 / 7) : 0;
  const first = completedDays.reduce<string | null>((min, day) => (min === null || day < min ? day : min), null);
  const span = first ? Math.min(28, days(first, today) + 1) : 0;
  const recent = completedDays.filter((day) => days(day, today) < span && day <= today).length;
  return {
    done,
    total,
    planned,
    lagWeeks: lag && rate ? Math.ceil(lag / rate) : 0,
    next: point
      ? {
          checkpoint: point,
          remaining: upTo(point.afterModule) - done,
          perWeek: Math.round(((upTo(point.afterModule) - done) / weeksLeft) * 10) / 10,
        }
      : null,
    recentPerWeek: span >= 7 ? Math.round(((recent * 7) / span) * 10) / 10 : null,
  };
}

export interface SkillReadiness {
  skill: Skill;
  /** Результат последней контрольной по навыку или доля отмеченных критериев самопроверки. */
  result: number;
  /** Чтение и аудирование — по контрольным; письмо и речь — самопроверка. */
  source: "test" | "self";
  /** Название контрольной или число заданий самопроверки. */
  basis: string;
}
