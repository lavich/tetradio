import { useEffect, useId, useState } from "react";
import { checkAnswer, checkTextAnswer } from "../../../domain/text-answer";
import { diffChars } from "../../../domain/spelling";
import { maskWriting } from "../../../domain/syllables";
import { WordArt } from "../../words/WordCardView";
import { Tick } from "../../../shared/Tick";
import { cx } from "../../../shared/cx";
import { Instruction } from "../notebook";
import exercise from "./exercise.module.css";
import s from "./spelling.module.css";
import { AnswerMask } from "./AnswerMask";
import { useRevealed, useRevealSpeech } from "./hooks";
import { wordOf, type ExerciseProps, type Status } from "./model";
import { PhraseReveal, Primary, QuietActions, QuietButton, Reveal, TaskHead, Verdict, WordReveal } from "./parts";

/** Ответ на строке листа после проверки: совпавшее чернилами, лишнее зачёркнуто ручкой, нужное — ручкой сверху. */
function Corrected({ value, expected }: { value: string; expected: string }) {
  return (
    <p className={exercise.written} data-testid="chars" lang="el">
      <span>
        {diffChars(value, expected).map((part, index) =>
          part.type === "same" ? (
            <span key={index}>{part.text}</span>
          ) : part.type === "wrong" ? (
            <span key={index} className={s.fixPair}>
              <s>{part.text}</s>
              {part.fix && <sup>{part.fix}</sup>}
            </span>
          ) : (
            <ins key={index}>{part.text}</ins>
          ),
        )}
      </span>
    </p>
  );
}

/**
 * Написание слова по переводу или фразы целиком по её переводу. У фразы проверка без послаблений артиклю.
 * После ответа задание уходит с листа: перевод и картинка входят в раскрытие, отдельно они задвоились бы.
 */
export function Spelling({
  item,
  onAnswer,
  onNext,
  nextLabel = "Далее",
  autoSpeak = false,
}: ExerciseProps & { autoSpeak?: boolean }) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{
    status: Status;
    message: string;
    skipped?: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  useEffect(() => {
    setValue("");
    setResult(null);
    setSaving(false);
  }, [item.id]);
  const revealed = useRevealed(!!result);
  const { card } = item;
  const expected = card.kind === "phrase" ? card.phrase.text : wordOf(card).greek;
  const mask = maskWriting(expected, { lead: true });
  const prompt = card.kind === "phrase" ? (card.phrase.translation ?? "") : wordOf(card).russian;
  useRevealSpeech(card, item.id, !!result, autoSpeak);
  const skip = async () => {
    if (result || saving) return;
    setSaving(true);
    const saved = await onAnswer({ correct: false, text: "" });
    setSaving(false);
    if (saved) setResult({ status: "wrong", message: "Ничего страшного — вот как это пишется.", skipped: true });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim() || result || saving) return;
    const checked = card.kind === "phrase" ? checkTextAnswer(value, [card.phrase.text]) : checkAnswer(value, expected);
    setSaving(true);
    const saved = await onAnswer({ correct: checked.status === "correct", text: value, status: checked.status });
    setSaving(false);
    if (saved) setResult(checked);
  };
  if (result)
    return (
      <>
        <div ref={revealed}>
          <Instruction prompt="Напиши по-гречески" />
          {!result.skipped &&
            (result.status === "correct" ? (
              <p className={exercise.written} lang="el">
                <span>{value}</span>
                <Tick className={exercise.writtenTick} label="верно" />
              </p>
            ) : (
              <Corrected value={value} expected={expected} />
            ))}
          <Verdict status={result.status}>
            <p>{result.message}</p>
            {result.status !== "correct" && !result.skipped && (
              <p className={s.legend}>Зачёркнуто — лишнее, сверху ручкой — как надо.</p>
            )}
          </Verdict>
          <Reveal>
            {card.kind === "phrase" ? (
              <PhraseReveal phrase={card.phrase} speak />
            ) : (
              <WordReveal word={wordOf(card)} speak />
            )}
          </Reveal>
        </div>
        <Primary onClick={onNext}>{nextLabel}</Primary>
      </>
    );
  return (
    <form id={formId} onSubmit={submit}>
      <TaskHead
        prompt="Напиши по-гречески"
        meaning={prompt}
        art={card.kind === "word" ? <WordArt word={card.word} className={exercise.pic} /> : undefined}
      />
      <div className={cx(s.field, card.kind === "phrase" && s.fieldPhrase)}>
        <AnswerMask mask={mask} value={value} />
        <input
          className={cx(s.answer, mask && s.masked)}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={saving}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="Твой ответ по-гречески"
          lang="el"
        />
      </div>
      <QuietActions>
        <QuietButton disabled={saving} onClick={skip}>
          Не знаю
        </QuietButton>
      </QuietActions>
      <Primary form={formId} disabled={!value.trim() || saving}>
        {saving ? "Сохраняем…" : "Проверить"}
      </Primary>
    </form>
  );
}
