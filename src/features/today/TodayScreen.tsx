import { Screen } from "../../app/Screen";
import { useNow } from "../../shared/clock";
import { useActiveSession, useInstalledCount, usePlan } from "../../shared/store";
import { CourseToday } from "./CourseToday";
import { CourseStart } from "./FirstRun";

export function TodayScreen() {
  const now = useNow();
  const plan = usePlan(now);
  const installed = useInstalledCount();
  const unfinished = useActiveSession();
  // План читается из локальной базы за доли секунды: пустая клетка без заголовка и заглушек, чтобы ничего не мелькало.
  if (!plan || installed === undefined || unfinished === undefined)
    return (
      <Screen wide>
        <div aria-busy="true" aria-label="План дня загружается" />
      </Screen>
    );
  if (!installed)
    return (
      <Screen>
        <h1 data-testid="today-title">Начните с курса</h1>
        <CourseStart />
      </Screen>
    );
  return (
    <Screen wide>
      <CourseToday plan={plan} now={now} unfinished={unfinished} />
    </Screen>
  );
}
