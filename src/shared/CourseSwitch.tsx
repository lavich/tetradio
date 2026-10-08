import { useRef, type KeyboardEvent } from "react";
import { useCourses, useCurrentCourse } from "./courses";
import { cx } from "./cx";
import css from "./course-switch.module.css";

interface Option {
  id: string;
  title: string;
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
        >
          {option.title}
        </button>
      ))}
    </div>
  );
}

/** Переключатель курса над заголовком «Курса», «Слов» и «Прогресса»; выбор общий для трёх экранов. Один курс — ничего. */
export function CourseSwitch() {
  const courses = useCourses();
  const [current, choose] = useCurrentCourse();
  if (!courses || courses.length < 2) return null;
  return (
    <Segmented
      label="Курс"
      testId="course-switch"
      options={courses}
      value={current}
      onChange={(id) => void choose(id)}
    />
  );
}
