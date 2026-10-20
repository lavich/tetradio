import { useRef, type KeyboardEvent } from "react";
import { useAllCourses, useCourses, useCurrentCourse, useShelfCourse } from "./courses";
import { cx } from "./cx";
import css from "./course-switch.module.css";

interface Option {
  id: string;
  title: string;
  /** Курс не начат: «+» перед именем, читалка слышит «не начат». */
  unstarted?: boolean;
}

/** Выбор одного курса: стрелки двигают выбор, Tab входит только в выбранный вариант. */
export function Segmented({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: Option[];
  value: string | null | undefined;
  onChange: (id: string) => void;
  testId: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const move = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : step ? index + step : undefined;
    if (target === undefined) return;
    event.preventDefault();
    const next = (target + options.length) % options.length;
    buttons.current[next]?.focus();
    onChange(options[next].id);
  };
  return (
    <div className={css.switch} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((option, index) => (
        <button
          key={option.id}
          ref={(node) => {
            buttons.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={index === selected}
          tabIndex={index === selected ? 0 : -1}
          className={cx(css.option, index === selected && css.selected)}
          onClick={() => onChange(option.id)}
          onKeyDown={(event) => move(event, index)}
          aria-label={option.unstarted ? `${option.title}, не начат` : undefined}
        >
          {option.unstarted ? <span aria-hidden="true">+ </span> : null}
          {option.title}
        </button>
      ))}
    </div>
  );
}

/**
 * Переключатель курса над заголовком «Курса», «Слов», «Чтения» и «Прогресса». На «Курсе» в нём и неначатые курсы
 * каталога: их начинают с полки. На остальных экранах — только начатые; один курс — ничего.
 */
export function CourseSwitch({ shelf = false }: { shelf?: boolean }) {
  const started = useCourses();
  const all = useAllCourses();
  const [current, choose] = useCurrentCourse();
  const shelfCourse = useShelfCourse();
  const courses = shelf ? all : started;
  if (!courses || courses.length < 2) return null;
  return (
    <Segmented
      label="Курс"
      testId="course-switch"
      options={courses.map((course) => ({
        id: course.id,
        title: course.short ?? course.title,
        unstarted: !course.installed,
      }))}
      value={shelf ? shelfCourse : current}
      onChange={(id) => void choose(id)}
    />
  );
}
