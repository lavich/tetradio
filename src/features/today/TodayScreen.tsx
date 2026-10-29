import { lazy, Suspense, useEffect } from "react";
import { Screen } from "../../app/Screen";
import {
  useLanguages,
  useLanguageSession,
  useStartedCourses,
  useTodayCourses,
  useTodayLanguage,
} from "../../shared/courses";
import { useInstalledCount, useLanguagePlan } from "../../shared/store";
import { CourseStart } from "./FirstRun";

// Блоки языков нужны, только когда уроки уже на устройстве: их код не входит в стартовый граф первого запуска и
// грузится, как только известно, что уроки есть, — параллельно с планом дня, которого экран и так ждёт.
let blocks: Promise<[typeof import("./LanguageToday"), typeof import("./LanguageLine")]> | undefined;
const loadBlocks = () => (blocks ??= Promise.all([import("./LanguageToday"), import("./LanguageLine")]));
const LanguageToday = lazy(() => loadBlocks().then(([module]) => ({ default: module.LanguageToday })));
const LanguageLine = lazy(() => loadBlocks().then(([, module]) => ({ default: module.LanguageLine })));
const AllPaused = lazy(() => import("./AllPaused").then((module) => ({ default: module.AllPaused })));

export function TodayScreen() {
  const today = useTodayLanguage();
  const language = today === "paused" ? undefined : today;
  const started = useStartedCourses();
  const allPaused = !!started?.length && started.every((course) => course.pausedAt);
  const plan = useLanguagePlan(started === undefined || allPaused || today === "paused" ? undefined : language);
  const installed = useInstalledCount();
  useEffect(() => {
    if (installed) void loadBlocks();
  }, [installed]);
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
        <CourseStart intro hint={false} />
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
  const loading = <div aria-busy="true" aria-label="План дня загружается" />;
  if (!plan || installed === undefined || unfinished === undefined || started === undefined || !courses)
    return <Screen wide>{loading}</Screen>;
  return (
    <Screen wide>
      <Suspense fallback={loading}>
        <LanguageToday
          language={language ?? null}
          courses={courses}
          plan={plan}
          unfinished={unfinished}
          more={others?.map((entry) => (
            <LanguageLine key={entry.code} language={entry} />
          ))}
        />
      </Suspense>
    </Screen>
  );
}
