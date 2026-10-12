import { useEffect, useState } from "react";
import { assemblyOptions, assemblySkipMessage, checkAssembly, formatSyllables } from "../../../domain/syllables";
import { WordArt } from "../../words/WordCardView";
import { Tick } from "../../../shared/Tick";
import { cx } from "../../../shared/cx";
import { useProfile } from "../../../shared/language";
import { Instruction } from "../notebook";
import exercise from "./exercise.module.css";
import s from "./assembly.module.css";
import { digitIndex, useRevealed, useRevealSpeech, useTaskKeys } from "./hooks";
import { wordOf, type ExerciseProps, type Status } from "./model";
import { Primary, QuietActions, QuietButton, Reveal, TaskHead, Verdict, WordReveal } from "./parts";

/** Поставленный слог отключается, и браузер снимает с него фокус — стрелки перестали бы работать. */
function keepFocusAfter(tile: HTMLButtonElement) {
  requestAnimationFrame(() => {
    const group = tile.parentElement;
    if (!group || (group.contains(document.activeElement) && document.activeElement !== tile)) return;
    const free = [...group.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const next = free.find((button) => tile.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
    (next ?? free[0] ?? group).focus();
  });
}

/**
 * Ступень перед свободным написанием: слово собирается из перемешанных слогов в строку листа. Только для слов.
 * После проверки собранное остаётся на строке, а деление на слоги — в итоге: в карточке его нет, а собирали именно его.
 */
export function Assembly({
  item,
  onAnswer,
  onNext,
  nextLabel = "Далее",
  autoSpeak = false,
}: ExerciseProps & { autoSpeak?: boolean }) {
  const [placed, setPlaced] = useState<number[]>([]);
  const [result, setResult] = useState<{
    status: Status;
    message: string;
    answer?: string;
    skipped?: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setPlaced([]);
    setResult(null);
    setSaving(false);
  }, [item.id]);
  const revealed = useRevealed(!!result);
  const word = wordOf(item.card);
  const lang = useProfile().code;
  useRevealSpeech(item.card, item.id, !!result, autoSpeak);
  const pool = assemblyOptions(word.greek, item.options);
  const complete = placed.length === pool.length;

  const check = async (skip = false) => {
    if ((!complete && !skip) || result || saving) return;
    const checked = checkAssembly(
      word.greek,
      placed.map((index) => pool[index]),
    );
    setSaving(true);
    const saved = await onAnswer(
      skip
        ? { correct: false, text: "" }
        : { correct: checked.status === "correct", text: checked.answer, status: checked.status },
    );
    setSaving(false);
    if (saved) setResult(skip ? { status: "wrong", message: assemblySkipMessage(word.greek), skipped: true } : checked);
  };
  const group = useTaskKeys({
    active: !result && !saving,
    onKey: (event) => {
      if (event.key === "Backspace") {
        if (!placed.length) return false;
        setPlaced(placed.slice(0, -1));
        return true;
      }
      if (event.key === "Enter") {
        if (event.target instanceof HTMLButtonElement) return false;
        void check();
        return true;
      }
      const index = digitIndex(event.key);
      if (index < 0 || index >= pool.length || placed.includes(index)) return false;
      const focused = document.activeElement;
      if (focused instanceof HTMLButtonElement && focused.dataset.key === String(index + 1)) keepFocusAfter(focused);
      setPlaced([...placed, index]);
      return true;
    },
  });
  return (
    <>
      {!result && (
        <>
          <TaskHead
            prompt="Собери слово"
            meaning={word.russian}
            art={<WordArt word={word} className={exercise.pic} />}
          />
          <div className={s.assembled} aria-label="Собранное слово" data-testid="assembled" lang={lang}>
            {placed.length === 0 ? (
              <span className={s.slotsHint}>Нажимай слоги по порядку</span>
            ) : (
              placed.map((index, position) => (
                <button
                  key={`${index}-${position}`}
                  type="button"
                  data-testid="placed"
                  disabled={saving}
                  className={s.placed}
                  onClick={() => setPlaced(placed.filter((_, i) => i !== position))}
                >
                  {pool[index]}
                </button>
              ))
            )}
          </div>
          <div
            ref={group}
            tabIndex={-1}
            role="group"
            aria-label={`Слоги слова «${word.russian}»`}
            className={s.tiles}
            lang={lang}
          >
            {pool.map((tile, index) => (
              <button
                key={`${tile}-${index}`}
                type="button"
                data-testid="tile"
                data-key={index < 9 ? index + 1 : undefined}
                disabled={placed.includes(index) || saving}
                className={s.tile}
                onClick={(event) => {
                  if (event.currentTarget === document.activeElement) keepFocusAfter(event.currentTarget);
                  setPlaced([...placed, index]);
                }}
              >
                {tile}
              </button>
            ))}
          </div>
          <QuietActions>
            <QuietButton disabled={saving} onClick={() => check(true)}>
              Не знаю
            </QuietButton>
          </QuietActions>
        </>
      )}
      {result && (
        <div ref={revealed}>
          <Instruction prompt="Собери слово" />
          {!result.skipped && result.answer && (
            <p className={exercise.written} lang={lang}>
              <span>{result.answer}</span>
              {result.status !== "wrong" && (
                <Tick
                  className={cx(exercise.writtenTick, result.status === "almost" && exercise.almost)}
                  label={result.status === "almost" ? "почти" : "верно"}
                />
              )}
            </p>
          )}
          <Verdict status={result.status}>
            <p>{result.message}</p>
            <p className={s.syllables} lang={lang}>
              {formatSyllables(word.greek)}
            </p>
          </Verdict>
          <Reveal>
            <WordReveal word={word} speak />
          </Reveal>
        </div>
      )}
      {result ? (
        <Primary focus onClick={onNext}>
          {nextLabel}
        </Primary>
      ) : (
        <Primary disabled={!complete || saving} onClick={() => check()}>
          {saving ? "Сохраняем…" : "Проверить"}
        </Primary>
      )}
    </>
  );
}
