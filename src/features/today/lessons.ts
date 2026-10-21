/** Строк уроков в блоке языка не больше трёх, считая крупный урок; остальные курсы — одной ссылкой «Ещё N курсов». */
export function lessonLines<T>(courses: T[], limit = 3): { shown: T[]; more: T[] } {
  return { shown: courses.slice(0, limit), more: courses.slice(limit) };
}
