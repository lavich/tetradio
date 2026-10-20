import { useRef, type KeyboardEvent } from "react";
import type { CourseEntry } from "../storage/courses";
import { useAllCourses, useCourses, useCurrentCourse, useShelfCourse } from "./courses";
import { cx } from "./cx";
import css from "./course-switch.module.css";

interface Option {
  id: string;
  title: string;
  /** Курс не начат: «+» перед именем, читалка слышит «не начат». */
  unstarted?: boolean;
  /** Вариант виден, но не выбирается: щелчок и стрелки его пропускают. Подпись видна рядом с именем. */
  disabled?: string;
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
    const direction = step ?? (event.key === "Home" ? 1 : -1);
    let next = (target + options.length) % options.length;
    for (let tries = 0; options[next].disabled && tries < options.length; tries++)
      next = (next + direction + options.length) % options.length;
    if (options[next].disabled) return;
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
          onClick={() => !option.disabled && onChange(option.id)}
          onKeyDown={(event) => move(event, index)}
          aria-disabled={option.disabled ? true : undefined}
          aria-label={
            option.unstarted
              ? `${option.title}, не начат`
              : option.disabled
                ? `${option.title}, ${option.disabled}`
                : undefined
          }
        >
          {option.unstarted ? <span aria-hidden="true">+ </span> : null}
          {option.title}
          {option.disabled ? <span className={css.optionNote}> · {option.disabled}</span> : null}
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
  return shelf ? <ShelfSwitch /> : <StartedSwitch />;
}
function StartedSwitch() {
  const [current, choose] = useCurrentCourse();
  return <Switch courses={useCourses()} value={current} choose={choose} />;
}
function ShelfSwitch() {
  const [, choose] = useCurrentCourse();
  return <Switch courses={useAllCourses()} value={useShelfCourse()} choose={choose} />;
}
function Switch({
  courses,
  value,
  choose,
}: {
  courses: CourseEntry[] | undefined;
  value: string | undefined;
  choose: (id: string) => Promise<void>;
}) {
  if (!courses || courses.length < 2) return null;
  return (
    <Segmented
      label="Курс"
      testId="course-switch"
      options={courses.map((course) => ({
        id: course.id,
        title: course.short ?? course.title,
        unstarted: !course.started,
      }))}
      value={value}
      onChange={(id) => void choose(id)}
    />
  );
}
