import { Screen } from "../../app/Screen";
import { useNow } from "../../shared/clock";
import { useCourses, useCourseSession, usePrimaryCourse } from "../../shared/courses";
import { useInstalledCount, usePlan } from "../../shared/store";
import { CourseToday } from "./CourseToday";
import { CourseStart } from "./FirstRun";
import { OtherCourse } from "./OtherCourse";

export function TodayScreen() {
  const now = useNow();
  const primary = usePrimaryCourse();
  const plan = usePlan(now, primary);
  const installed = useInstalledCount();
  const unfinished = useCourseSession(primary ?? undefined);
  const others = useCourses()?.filter((course) => course.id !== primary);
  // План читается из локальной базы за доли секунды: пустая клетка без заголовка и заглушек, чтобы ничего не мелькало.
  if (installed === 0)
    return (
      <Screen>
        <h1 data-testid="today-title">Начните с курса</h1>
        <CourseStart />
      </Screen>
    );
  if (!plan || installed === undefined || unfinished === undefined)
    return (
      <Screen wide>
        <div aria-busy="true" aria-label="План дня загружается" />
      </Screen>
    );
  return (
    <Screen wide>
      <CourseToday
        courseId={primary ?? undefined}
        plan={plan}
        now={now}
        unfinished={unfinished}
        more={others?.map((course) => (
          <OtherCourse key={course.id} course={course} now={now} />
        ))}
      />
    </Screen>
  );
}
