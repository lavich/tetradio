import { addDays, mondayOf } from "./time";

/** Ориентир курса — 2–3 занятия в неделю: с двух дней уроков неделя считается выполненной. */
export const WEEK_GOAL = 2;

export interface GridDay {
  day: string;
  lesson: boolean;
  review: boolean;
  today: boolean;
  future: boolean;
  paused: boolean;
}

export interface GridWeek {
  monday: string;
  /** Номер месяца 0–11 над столбцом, если подпись нужна. */
  month?: number;
  days: GridDay[];
  lessons: number;
  reviews: number;
  goal: boolean;
}

export function weekGrid(
  { lessons, reviews }: { lessons: string[]; reviews: string[] },
  today: string,
  pausedFrom?: string,
): GridWeek[] {
  const first = [lessons[0], reviews[0]].filter((day) => day && day <= today).sort()[0];
  if (!first) return [];
  const lessonSet = new Set(lessons);
  const reviewSet = new Set(reviews);
  const weeks: GridWeek[] = [];
  for (let monday = mondayOf(first); monday <= today; monday = addDays(monday, 7)) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(monday, index);
      const future = day > today;
      const lesson = !future && lessonSet.has(day);
      const review = !future && reviewSet.has(day);
      return {
        day,
        lesson,
        review,
        today: day === today,
        future,
        paused: !!pausedFrom && !future && day >= pausedFrom && !lesson && !review,
      };
    });
    const lessonCount = days.filter((day) => day.lesson).length;
    weeks.push({
      monday,
      days,
      lessons: lessonCount,
      reviews: days.filter((day) => day.review).length,
      goal: lessonCount >= WEEK_GOAL,
    });
  }
  const monthOf = (day: string) => Number(day.slice(5, 7)) - 1;
  weeks.forEach((week, index) => {
    const month = monthOf(week.monday);
    const opens =
      index === 0 ? monthOf(weeks[1]?.monday ?? week.monday) === month : monthOf(weeks[index - 1].monday) !== month;
    if (opens) week.month = month;
  });
  return weeks;
}
