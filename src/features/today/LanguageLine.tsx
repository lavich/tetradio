import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { LanguageEntry } from "../../storage/courses";
import { useAction } from "../../shared/action";
import { useLanguageSession, useTodayCourses } from "../../shared/courses";
import { useLanguagePlan } from "../../shared/store";
import { sessionPath, startSession } from "../learning/session-actions";
import { CourseLessonLine, MoreCourses } from "./CourseLessonLine";
import { AFTER_PAUSE } from "./DayNotes";
import { lessonLines } from "./lessons";
import css from "./today.module.css";

/**
 * Другой язык на «Сегодня» — компактно под основным: одно повторение карточек всех его курсов и строки следующих
 * уроков его курсов с уроками на устройстве.
 */
export function LanguageLine({ language }: { language: LanguageEntry }) {
  const navigate = useNavigate();
  const plan = useLanguagePlan(language.code);
  const unfinished = useLanguageSession(language.code);
  const planned = useTodayCourses(language.code);
  const courses = planned?.filter((course) => course.installed);
  const { busy, problem, setProblem, run } = useAction("Не удалось начать повторение");
  if (!plan || unfinished === undefined || !planned || !courses?.length) return null;
  const due = plan.newRefs.length + plan.reviews.length;
  const review = () =>
    run(async () => {
      const session = unfinished ?? (await startSession(new Date(), { courseIds: planned.map((course) => course.id) }));
      if (!session) return setProblem("На сегодня карточек нет.");
      void navigate(await sessionPath(session));
    });
  const { shown, more } = lessonLines(courses);
  const titleId = `language-${language.code}`;
  return (
    <section className={css.other} aria-labelledby={titleId} data-testid="other-language">
      <div className={css.otherHead}>
        <h2 id={titleId} className={css.otherTitle}>
          {language.title}
        </h2>
        {unfinished || due ? (
          <Button size="md" variant="soft" className="w-auto flex-none" onClick={review} disabled={busy}>
            {unfinished ? "Продолжить" : `Повторить ${due}`}
          </Button>
        ) : (
          <span className={css.otherNone}>повторений нет</span>
        )}
      </div>
      {plan.pauseDebt ? (
        <p className={css.otherNone} data-testid="after-pause">
          {AFTER_PAUSE}
        </p>
      ) : null}
      {shown.map((course) => (
        <CourseLessonLine key={course.id} course={course} caption={courses.length > 1} />
      ))}
      <MoreCourses language={language.title} courses={more} />
      {problem && (
        <p className={css.problem} role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
