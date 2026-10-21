import { useRef, type KeyboardEvent } from "react";
import type { Language } from "../domain/language";
import { useCurrentLanguage, useLanguages, useShelfLanguage } from "./courses";
import { cx } from "./cx";
import css from "./course-switch.module.css";

interface Option {
  id: string;
  title: string;
  /** Не начат: «+» перед именем, читалка слышит «не начат». */
  unstarted?: boolean;
  /** Вариант виден, но не выбирается: щелчок и стрелки его пропускают. Подпись видна рядом с именем. */
  disabled?: string;
}

/** Выбор одного варианта: стрелки двигают выбор, Tab входит только в выбранный вариант. */
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
 * Переключатель языка над заголовком «Курса», «Слов», «Чтения» и «Прогресса». На «Курсе» в нём и языки без начатых
 * курсов: их курсы начинают с полки. На остальных экранах — только языки с уроками на устройстве; один язык — ничего.
 */
export function LanguageSwitch({ shelf = false }: { shelf?: boolean }) {
  const all = useLanguages();
  const [current, choose] = useCurrentLanguage();
  const shelfValue = useShelfLanguage();
  const languages = shelf ? all : all?.filter((language) => language.installed);
  if (!languages || languages.length < 2) return null;
  return (
    <Segmented
      label="Язык"
      testId="language-switch"
      options={languages.map((language) => ({
        id: language.code,
        title: language.title,
        unstarted: !language.started,
      }))}
      value={shelf ? shelfValue : current}
      onChange={(code) => void choose(code as Language)}
    />
  );
}
