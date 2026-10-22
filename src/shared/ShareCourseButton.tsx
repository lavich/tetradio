import { Share2 } from "lucide-react";
import type { Course } from "../domain/types";
import css from "./share-course.module.css";

export function ShareCourseButton({ course }: { course: Pick<Course, "id" | "title"> }) {
  return (
    <button
      type="button"
      className={css.share}
      aria-label={`Поделиться курсом «${course.title}»`}
      onClick={() => void import("../platform/share").then((share) => share.shareCourse(course))}
    >
      <Share2 aria-hidden size={16} /> Поделиться курсом
    </button>
  );
}
