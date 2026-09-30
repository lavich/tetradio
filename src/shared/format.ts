const DATIVE: Record<string, string> = {
  понедельник: "понедельнику",
  вторник: "вторнику",
  среда: "среде",
  четверг: "четвергу",
  пятница: "пятнице",
  суббота: "субботе",
  воскресенье: "воскресенью",
};
export const plural = (count: number, forms: [string, string, string]) => {
  const n = Math.abs(count) % 100,
    tail = n % 10;
  return forms[n > 10 && n < 20 ? 2 : tail > 1 && tail < 5 ? 1 : tail === 1 ? 0 : 2];
};
export const withCount = (count: number, forms: [string, string, string]) => `${count} ${plural(count, forms)}`;
export const WORDS: [string, string, string] = ["слово", "слова", "слов"];
export const CARDS: [string, string, string] = ["карточка", "карточки", "карточек"];
export const PHRASES: [string, string, string] = ["фраза", "фразы", "фраз"];
export const DAYS: [string, string, string] = ["день", "дня", "дней"];
export const LESSONS: [string, string, string] = ["занятия", "занятий", "занятий"];
export const LESSONS_COUNT: [string, string, string] = ["урок", "урока", "уроков"];
export const TIMES: [string, string, string] = ["ответ", "ответа", "ответов"];
const day = (value: string) => new Date(`${value}T12:00:00Z`);
export const weekday = (value: string) => day(value).toLocaleDateString("ru-RU", { weekday: "long", timeZone: "UTC" });
export const dativeWeekday = (value: string) => DATIVE[weekday(value)] ?? weekday(value);
export const dayMonth = (value: string) =>
  day(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const shortTitle = (title: string) => title.replace(/^Урок\s+/i, "");
/** Название урока внутри фразы: «Урок 1.4» склоняется («урока 1.4»), свой набор идёт в кавычках. */
export const lessonIn = (title: string, form: "урок" | "урока" | "уроку") =>
  /^Урок\s/i.test(title) ? `${form} ${shortTitle(title)}` : `«${title}»`;
export const minutes = (ms: number) =>
  `${Math.max(1, Math.round(ms / 60000))} ${plural(Math.max(1, Math.round(ms / 60000)), ["минута", "минуты", "минут"])}`;
