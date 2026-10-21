import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight } from "lucide-react";
import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { followCourse, type CourseEntry } from "../../storage/courses";
import { moduleViews, nextStep } from "../../storage/course";
import { reportError } from "../../reporting/reporting";
import { cx } from "../../shared/cx";
import { withCount } from "../../shared/format";
import css from "./today.module.css";

export const courseCaption = (course: Pick<CourseEntry, "short" | "title">) => course.short ?? course.title;
/** Подпись курса над строкой урока; точка для читалки отделяет её от названия урока в имени ссылки. */
export const CourseCaption = ({ children }: { children: string }) => (
  <span className={css.courseCaption}>
    <span data-testid="course-caption">{children}</span>
    <span className="sr-only">. </span>
  </span>
);

/** Строка следующего урока курса в блоке языка; подпись курса — когда у языка на «Сегодня» две строки уроков и больше. */
export function CourseLessonLine({ course, caption }: { course: CourseEntry; caption: boolean }) {
  const views = useLiveQuery(() => moduleViews(course.id), [course.id]);
  if (!views) return null;
  const next = nextStep(views);
  const label = caption && <CourseCaption>{courseCaption(course)}</CourseCaption>;
  if (next) {
    const text = `${next.lesson.tally.done ? "Продолжить" : "Урок"}: ${next.lesson.title}`;
    return (
      <Link
        to={`/course/${next.view.module.id}/${next.lesson.id}`}
        className={cx(css.otherLesson, caption && css.captioned)}
        aria-label={caption ? `${courseCaption(course)}. ${text}` : undefined}
        data-testid="course-line"
      >
        <span className="grid min-w-0">
          {label}
          <span className="truncate">{text}</span>
        </span>
        <ArrowRight aria-hidden size={16} />
      </Link>
    );
  }
  if (!views.length) return null;
  return (
    <p className={cx(css.otherDone, caption && css.captioned)} data-testid="course-line">
      {label}
      <span className={css.otherNone}>Все уроки пройдены</span>
    </p>
  );
}

export function MoreCourses({ language, courses }: { language: string; courses: CourseEntry[] }) {
  const navigate = useNavigate();
  const opening = useRef(false);
  if (!courses.length) return null;
  const count = withCount(courses.length, ["курс", "курса", "курсов"]);
  const open = (event: React.MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (opening.current) return;
    opening.current = true;
    void followCourse(courses[0].id)
      .catch((error: unknown) => void reportError(error, { category: "storage" }))
      .finally(() => {
        opening.current = false;
        void navigate("/course");
      });
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
