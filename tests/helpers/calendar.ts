import type { CourseCalendar } from "../../src/content/course";

export const GREEK_CALENDAR: CourseCalendar = {
  start: "2026-10-05",
  checkpoints: [
    { label: "K1", title: "Контрольная A1", afterModule: 8, date: "2026-12-13" },
    { label: "M1", title: "Пробник M1", afterModule: 15, date: "2027-02-13" },
    { label: "M2", title: "Пробник M2", afterModule: 20, date: "2027-03-29" },
    { label: "M3", title: "Пробник M3", afterModule: 24, date: "2027-05-02" },
  ],
};
