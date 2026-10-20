import { lazy, Suspense } from "react";
import { Screen } from "../../app/Screen";
import { useCourses, useCourseSession, useStartedCourses, useTodayCourse } from "../../shared/courses";
import { useInstalledCount, usePlan } from "../../shared/store";
import { CourseToday } from "./CourseToday";
import { CourseStart, OFFLINE_HINT } from "./FirstRun";
import { OtherCourse } from "./OtherCourse";

const AllPaused = lazy(() => import("./AllPaused").then((module) => ({ default: module.AllPaused })));

export function TodayScreen() {
  const primary = useTodayCourse();
  const started = useStartedCourses();
  const allPaused = !!started?.length && started.every((course) => course.pausedAt);
  const plan = usePlan(started === undefined || allPaused ? undefined : primary);
  const installed = useInstalledCount();
  const unfinished = useCourseSession(primary ?? undefined);
  const others = useCourses()?.filter((course) => course.id !== primary && !course.pausedAt);

  // План читается из локальной базы за доли секунды: пустая клетка без заголовка и заглушек, чтобы ничего не мелькало.
  if (installed === 0)
    return (
      <Screen>
        <h1 data-testid="today-title">Выберите курс</h1>
        <p className="mb-1 text-muted-foreground">
          Курсы языков с уроками по программе и ежедневным повторением карточек
        </p>
        <p className="mt-0 mb-6 text-sm text-muted-foreground">{OFFLINE_HINT}</p>
        <CourseStart hint={false} />
      </Screen>
    );
  if (allPaused)
    return (
      <Screen>
        <Suspense fallback={<div aria-busy="true" aria-label="План дня загружается" />}>
          <AllPaused started={started ?? []} />
        </Suspense>
      </Screen>
    );
  if (!plan || installed === undefined || unfinished === undefined || started === undefined)
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
        unfinished={unfinished}
        more={others?.map((course) => (
          <OtherCourse key={course.id} course={course} />
        ))}
      />
    </Screen>
  );
}
