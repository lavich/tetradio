import { lazy, Suspense } from "react";
import { Screen } from "../../app/Screen";
import {
  useLanguages,
  useLanguageSession,
  useStartedCourses,
  useTodayCourses,
  useTodayLanguage,
} from "../../shared/courses";
import { useInstalledCount, useLanguagePlan } from "../../shared/store";
import { LanguageToday } from "./CourseToday";
import { CourseStart, OFFLINE_HINT } from "./FirstRun";
import { LanguageLine } from "./LanguageLine";

const AllPaused = lazy(() => import("./AllPaused").then((module) => ({ default: module.AllPaused })));

export function TodayScreen() {
  const language = useTodayLanguage();
  const started = useStartedCourses();
  const allPaused = !!started?.length && started.every((course) => course.pausedAt);
  const plan = useLanguagePlan(started === undefined || allPaused ? undefined : language);
  const installed = useInstalledCount();
  const unfinished = useLanguageSession(language ?? undefined);
  const courses = useTodayCourses(language ?? undefined);
  const others = useLanguages()?.filter(
    (entry) =>
      entry.code !== language && entry.courses.some((course) => course.installed && course.started && !course.pausedAt),
  );

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
  if (!plan || installed === undefined || unfinished === undefined || started === undefined || !courses)
    return (
      <Screen wide>
        <div aria-busy="true" aria-label="План дня загружается" />
      </Screen>
    );
  return (
    <Screen wide>
      <LanguageToday
        language={language ?? null}
        courses={courses}
        plan={plan}
        unfinished={unfinished}
        more={others?.map((entry) => (
          <LanguageLine key={entry.code} language={entry} />
        ))}
      />
    </Screen>
  );
}
