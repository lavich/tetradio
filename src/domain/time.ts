/** Час смены учебного дня: ответ поздно вечером и занятие после полуночи — один день, как в Anki. */
export const DAY_STARTS_AT = 4;
/** Часовой пояс устройства: по нему считаются день, сроки и неделя. */
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const dayFormats = new Map<string, Intl.DateTimeFormat>();
const clockFormats = new Map<string, Intl.DateTimeFormat>();
function formatIn(cache: Map<string, Intl.DateTimeFormat>, timezone: string, make: () => Intl.DateTimeFormat) {
  let format = cache.get(timezone);
  if (!format) cache.set(timezone, (format = make()));
  return format;
}
/** Календарный день в выбранной зоне, без деления миллисекунд на сутки. */
export function localDay(date: Date, timezone: string): string {
  const parts = formatIn(
    dayFormats,
    timezone,
    () => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }),
  ).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const addDays = (day: string, count: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
/** Понедельник недели, в которую входит день. */
export const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
export const formatDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
/** Момент начала календарного дня (или часа `hour` этого дня) в зоне; переход летнего времени учитывается повторным расчётом смещения. */
export function zonedStart(day: string, timezone: string, hour = 0): Date {
  const guess = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  const offset = (date: Date) => {
    const parts = formatIn(
      clockFormats,
      timezone,
      () =>
        new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          hourCycle: "h23",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
    ).formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return (
      Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - date.getTime()
    );
  };
  const first = new Date(guess.getTime() - offset(guess));
  return new Date(guess.getTime() - offset(first));
}
export function studyDay(at: Date, timezone: string): string {
  const day = localDay(at, timezone);
  return at < zonedStart(day, timezone, DAY_STARTS_AT) ? addDays(day, -1) : day;
}
