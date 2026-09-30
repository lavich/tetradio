import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../storage/db";
import css from "./course.module.css";

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/**
 * Дата экзамена честно: пока местная дата не подтверждена, показывается общая дата с пометкой и источником,
 * без обратного отсчёта.
 */
export function ExamLine({ courseId }: { courseId: string }) {
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId]);
  const exam = course?.exam;
  if (!exam) return null;
  return (
    <p className={`${css.meta} mt-1`} data-testid="exam-line">
      {exam.title}: {longDate(exam.date)}
      {exam.localConfirmed ? "" : " — общая дата, дата на Кипре не подтверждена"}
      {" · "}
      <a href={exam.source} target="_blank" rel="noreferrer">
        источник
      </a>
      , проверено {longDate(exam.checkedAt)}
    </p>
  );
}
