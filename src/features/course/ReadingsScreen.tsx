import { useLiveQuery } from "dexie-react-hooks";
import { useId } from "react";
import { Screen } from "../../app/Screen";
import { CourseSwitch } from "../../shared/CourseSwitch";
import { useCourseProfile } from "../../shared/language";
import { currentCourse } from "../../storage/courses";
import { courseReadings } from "../../storage/readings";
import base from "./course.module.css";
import css from "./module-screen.module.css";
import { ReadingRow } from "./ReadingRow";
import { closedLine, groupByModule, type ReadingGroup } from "./reading-groups";
import reading from "./readings.module.css";

const FROM_READINGS = { fromReadings: true };

export function ReadingsScreen() {
  const data = useLiveQuery(async () => {
    const courseId = await currentCourse();
    return { courseId, readings: courseId ? await courseReadings(courseId) : null };
  }, []);
  const profile = useCourseProfile(data?.courseId);
  if (data === undefined || !data.readings) return <Screen />;
  const { open, unread, closed, pending } = data.readings;
  return (
    <Screen>
      <CourseSwitch />
      <h1>Чтение</h1>
      {open.length ? (
        <>
          <p className={base.meta} data-testid="reading-summary">
            Прочитано {open.length - unread.length} из {open.length} открытых
          </p>
          {pending > 0 ? <p className={base.meta}>Часть текстов ещё скачивается.</p> : null}
          {groupByModule(open).map((group) => (
            <Group key={group.module.number} group={group} code={profile.code} />
          ))}
        </>
      ) : pending > 0 ? (
        <p className={base.meta}>Тексты скачиваются.</p>
      ) : !closed ? (
        <p className={base.meta}>В этом курсе текстов нет.</p>
      ) : null}
      {pending === 0 && closed ? <p className={reading.closed}>{closedLine(closed)}</p> : null}
    </Screen>
  );
}

function Group({ group, code }: { group: ReadingGroup; code: string }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading} className={reading.module}>
        Модуль {group.module.number} · <span lang={code}>{group.module.title}</span>
      </h2>
      <ol className={css.lessons}>
        {group.items.map((view) => (
          <ReadingRow key={view.reading.id} view={view} code={code} state={FROM_READINGS} />
        ))}
      </ol>
    </section>
  );
}
