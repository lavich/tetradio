const capital = (text: string) => text.charAt(0).toLocaleUpperCase("el") + text.slice(1);
/** «Πέμπτη, 1 Οκτωβρίου»: день плана занятия, а не момент открытия экрана. */
export function greekDate(day: string) {
  const parts = new Intl.DateTimeFormat("el-GR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).formatToParts(new Date(`${day}T12:00:00Z`));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${capital(get("weekday"))}, ${get("day")} ${get("month")}`;
}

/** Цвета обложек: греческие школьные тетради яркие; цвет повторяется по номеру модуля. */
const COVERS = ["#2f6d4f", "#b8452b", "#2c4f9e", "#936c15", "#7b3f74", "#1f6f7a"];
export const coverColor = (number: number) => COVERS[(number - 1) % COVERS.length];
