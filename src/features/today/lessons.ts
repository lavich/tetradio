export function lessonLines<T>(courses: T[], limit = 3): { shown: T[]; more: T[] } {
  return { shown: courses.slice(0, limit), more: courses.slice(limit) };
}
