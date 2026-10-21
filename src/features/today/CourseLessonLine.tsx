import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { followCourse, type CourseEntry } from "../../storage/courses";
import { moduleViews, nextStep } from "../../storage/course";
import { reportError } from "../../reporting/reporting";
import { cx } from "../../shared/cx";
import { withCount } from "../../shared/format";
import css from "./today.module.css";

export const courseCaption = (course: Pick<CourseEntry, "short" | "title">) => course.short ?? course.title;

/** Строка следующего урока курса в блоке языка; подпись курса — когда у языка на «Сегодня» два курса и больше. */
export function CourseLessonLine({ course, caption }: { course: CourseEntry; caption: boolean }) {
  const views = useLiveQuery(() => moduleViews(course.id), [course.id]);
  if (!views) return null;
  const next = nextStep(views);
  const label = caption && (
    <span className={css.courseCaption} data-testid="course-caption">
      {courseCaption(course)}
    </span>
  );
  if (next)
    return (
      <Link
        to={`/course/${next.view.module.id}/${next.lesson.id}`}
        className={cx(css.otherLesson, caption && css.captioned)}
        data-testid="course-line"
      >
        <span className="grid min-w-0">
          {label}
          <span className="truncate">
            {next.lesson.tally.done ? "Продолжить" : "Урок"}: {next.lesson.title}
          </span>
        </span>
        <ArrowRight aria-hidden size={16} />
      </Link>
    );
  if (!views.length) return null;
  return (
    <p className={cx(css.otherDone, caption && css.captioned)} data-testid="course-line">
      {label}
      <span className={css.otherNone}>Все уроки пройдены</span>
    </p>
  );
}

/** «Ещё N курсов →» открывает «Курс» на языке этих курсов. */
export function MoreCourses({ language, courses }: { language: string; courses: CourseEntry[] }) {
  const navigate = useNavigate();
  if (!courses.length) return null;
  const count = withCount(courses.length, ["курс", "курса", "курсов"]);
  const open = (event: React.MouseEvent) => {
    event.preventDefault();
    void followCourse(courses[0].id)
      .catch((error: unknown) => void reportError(error, { category: "storage" }))
      .finally(() => void navigate("/course"));
  };
  return (
    <Link
      to="/course"
      onClick={open}
      className={css.moreCourses}
      aria-label={`${language}: ещё ${count} на «Курсе»`}
      data-testid="more-courses"
    >
      Ещё {count} →
    </Link>
  );
}
