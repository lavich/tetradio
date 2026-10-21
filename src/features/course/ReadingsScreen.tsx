import { useLiveQuery } from "dexie-react-hooks";
import { Fragment, useId } from "react";
import { Screen } from "../../app/Screen";
import { LanguageSwitch } from "../../shared/CourseSwitch";
import { DEFAULT_LANGUAGE } from "../../domain/language";
import { courseName } from "../../shared/courses";
import { courses, currentLanguage } from "../../storage/courses";
import { languageReadings, type CourseReadings } from "../../storage/readings";
import base from "./course.module.css";
import css from "./module-screen.module.css";
import { ReadingRow } from "./ReadingRow";
import { closedLine, groupByModule, type ReadingGroup } from "./reading-groups";
import reading from "./readings.module.css";

const FROM_READINGS = { fromReadings: true };

export function ReadingsScreen() {
  const data = useLiveQuery(async () => {
    const language = await currentLanguage();
    const started = (await courses()).filter((course) => course.language === language && course.started);
    return { language, several: started.length > 1, readings: await languageReadings(language) };
  }, []);
  if (data === undefined) return <Screen />;
  const { language, several, readings } = data;
  const code = language ?? DEFAULT_LANGUAGE;
  const { groups, open, unread, pending } = readings;
  const closed = groups.reduce((sum, group) => sum + group.readings.closed, 0);
  return (
    <Screen>
      <LanguageSwitch />
      <h1>Чтение</h1>
      {open ? (
        <>
          <p className={base.meta} data-testid="reading-summary">
            Прочитано {open - unread} из {open} открытых
          </p>
          {pending > 0 ? <p className={base.meta}>Часть текстов ещё скачивается.</p> : null}
        </>
      ) : pending > 0 ? (
        <p className={base.meta}>Тексты скачиваются.</p>
      ) : !closed ? (
        <p className={base.meta}>{several ? "У курсов языка текстов нет." : "В этом курсе текстов нет."}</p>
      ) : null}
      {groups.map(({ course, readings: own }) =>
        several ? (
          <CourseGroup key={course.id} title={courseName(course)} readings={own} code={code} quiet={pending > 0} />
        ) : (
          <Fragment key={course.id}>
            {groupByModule(own.open).map((group) => (
              <Group key={group.module.number} group={group} code={code} level={2} />
            ))}
            {pending === 0 && own.closed ? <p className={reading.closed}>{closedLine(own.closed)}</p> : null}
          </Fragment>
        ),
      )}
    </Screen>
  );
}

/** Тексты одного курса среди курсов языка: заголовок курса, модули и строка о закрытых текстах курса. */
function CourseGroup({
  title,
  readings,
  code,
  quiet,
}: {
  title: string;
  readings: CourseReadings;
  code: string;
  /** Пока тексты скачиваются, счёт закрытых неполон. */
  quiet: boolean;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} data-testid="reading-course">
      <h2 id={heading} className={reading.course}>
        {title}
      </h2>
      {groupByModule(readings.open).map((group) => (
        <Group key={group.module.number} group={group} code={code} level={3} />
      ))}
      {!quiet && readings.closed ? <p className={reading.closed}>{closedLine(readings.closed)}</p> : null}
    </section>
  );
}

function Group({ group, code, level }: { group: ReadingGroup; code: string; level: 2 | 3 }) {
  const heading = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={heading}>
      <Heading id={heading} className={reading.module}>
        Модуль {group.module.number} · <span lang={code}>{group.module.title}</span>
      </Heading>
      <ol className={css.lessons}>
        {group.items.map((view) => (
          <ReadingRow key={view.reading.id} view={view} code={code} state={FROM_READINGS} level={level === 2 ? 3 : 4} />
        ))}
      </ol>
    </section>
  );
}
