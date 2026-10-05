import { useEffect, useState } from "react";
import { Tick } from "../../../shared/Tick";
import { cx } from "../../../shared/cx";
import { Instruction } from "../notebook";
import exercise from "./exercise.module.css";
import s from "./choice.module.css";
import { useRevealed } from "./hooks";
import type { ExerciseProps } from "./model";
import { Primary, QuietActions, QuietButton } from "./parts";

/** Короткие варианты — сеткой 2 × 2, иначе строками α) β) γ) δ). Порог — то, что помещается в половину узкого листа. */
const SHORT_OPTION = 12;
const LETTERS = ["α", "β", "γ", "δ", "ε", "ζ"];
export const optionsFit = (options: string[]) =>
  options.length <= 4 && options.every((option) => [...option].length <= SHORT_OPTION);

export function Choice({
  item,
  onAnswer,
  onNext,
  onSkip,
  nextLabel = "Далее",
  prompt,
  head,
  aside,
  options,
  greekOptions,
  correct,
  after,
  audio,
}: ExerciseProps & {
  prompt: string;
  head?: React.ReactNode;
  aside?: React.ReactNode;
  options: string[];
  greekOptions?: boolean;
  correct: string;
  after?: React.ReactNode;
  /** Аудиоупражнение: кроме «Не знаю» можно честно отложить задание без оценки. */
  audio?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const answered = picked !== null;
  const choose = async (option: string | null) => {
    if (answered || saving) return;
    setSaving(true);
    const saved = await onAnswer({ correct: option === correct, text: option ?? "" });
    setSaving(false);
    if (saved) setPicked(option ?? "");
  };
  useEffect(() => {
    setPicked(null);
    setSaving(false);
  }, [item.id]);
  // Выбор раскрывается строкой под вариантами: подводим её, не уводя варианты из вида.
  const revealed = useRevealed(answered, "nearest");
  const grid = optionsFit(options);
  const letter = (index: number) => LETTERS[index] ?? String(index + 1);
  const right = options.indexOf(correct);
  return (
    <>
      <div className={exercise.cardRow}>
        <div className="min-w-0 flex-1">
          <Instruction prompt={prompt} />
          {head}
        </div>
        {aside}
      </div>
      <div className={grid ? s.grid : s.lines} lang={greekOptions ? "el" : undefined}>
        {options.map((option) => {
          const mark = answered
            ? option === correct
              ? "correct"
              : option === picked
                ? "wrong"
                : undefined
            : undefined;
          return (
            <button
              key={option}
              type="button"
              data-testid="option"
              data-answer={mark}
              disabled={answered || saving}
              className={cx(grid ? s.chip : s.line, mark && s[mark])}
              onClick={() => choose(option)}
            >
              <span>{option}</span>
              {mark === "correct" && (
                <>
                  <Tick className={s.optionTick} label="верно" />
                  <span className="sr-only">Правильный ответ</span>
                </>
              )}
              {mark === "wrong" && <span className="sr-only">Неправильный ответ</span>}
            </button>
          );
        })}
      </div>
      {answered && (
        <p className={picked === correct ? s.okLine : s.fixLine} role="status" ref={revealed}>
          {picked === correct ? (
            "Верно."
          ) : (
            <>
              Верно:{" "}
              <span lang={greekOptions ? "el" : undefined}>
                {grid || right < 0 ? "" : `${letter(right)}) `}
                {correct}
              </span>
            </>
          )}
        </p>
      )}
      {!answered && (
        <QuietActions>
          <QuietButton disabled={saving} onClick={() => choose(null)}>
            Не знаю
          </QuietButton>
          {audio && onSkip && (
            <QuietButton disabled={saving} onClick={onSkip}>
              Не могу послушать сейчас
            </QuietButton>
          )}
        </QuietActions>
      )}
      {answered && after}
      <Primary disabled={!answered} focus={answered} onClick={onNext}>
        {nextLabel}
      </Primary>
    </>
  );
}
