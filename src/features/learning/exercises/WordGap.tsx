import { useEffect, useId, useState } from "react";
import { maskWriting } from "../../../domain/syllables";
import { checkTextAnswer } from "../../../domain/text-answer";
import { gapAnswer, gapped, gapWord } from "../../../domain/word-gap";
import { Tick } from "../../../shared/Tick";
import { useProfile } from "../../../shared/language";
import { Instruction } from "../notebook";
import exercise from "./exercise.module.css";
import s from "./spelling.module.css";
import { AnswerMask } from "./AnswerMask";
import { focusWithKeyboard, useRevealed } from "./hooks";
import type { ExerciseProps, Status } from "./model";
import { Primary, QuietActions, QuietButton, Verdict } from "./parts";
import { Corrected } from "./Spelling";

/** Попытка после ошибки в одном слове фразы: вписать только это слово, с маской, как в основном написании. */
export function WordGap({ item, onAnswer, onNext, nextLabel = "Далее" }: ExerciseProps) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{ status: Status; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const profile = useProfile();
  useEffect(() => {
    setValue("");
    setResult(null);
    setSaving(false);
  }, [item.id]);
  const revealed = useRevealed(!!result);
  if (item.card.kind !== "phrase" || item.gap === undefined) throw new Error("Пропуск получил не фразу");
  const { phrase } = item.card;
  const word = gapWord(phrase.text, item.gap);
  const mask = maskWriting(word, { lead: true });
  const write = "Впиши пропущенное слово";
  const answer = async (text: string) => {
    if (result || saving) return;
    const checked = checkTextAnswer(gapAnswer(text), [word], profile);
    setSaving(true);
    const saved = await onAnswer({ correct: checked.status === "correct", text, status: checked.status });
    setSaving(false);
    if (saved) setResult(text ? checked : { status: "wrong", message: "Ничего страшного — вот как это пишется." });
  };
  const sentence = (fill?: string) => (
    <p className={exercise.phrase} lang={profile.code} data-testid="gap-phrase">
      {gapped(phrase.text, item.gap!, fill)}
    </p>
  );
  if (result)
    return (
      <>
        <div ref={revealed}>
          <Instruction prompt={write} />
          {sentence(word)}
          {value &&
            (result.status === "correct" ? (
              <p className={exercise.written} lang={profile.code}>
                <span>{value}</span>
                <Tick className={exercise.writtenTick} label="верно" />
              </p>
            ) : (
              <Corrected value={value} expected={word} />
            ))}
          <Verdict status={result.status}>
            <p>{result.message}</p>
          </Verdict>
        </div>
        <Primary focus onClick={onNext}>
          {nextLabel}
        </Primary>
      </>
    );
  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) void answer(value);
      }}
    >
      <Instruction prompt={write} />
      {phrase.translation ? <p className={exercise.task}>{phrase.translation}</p> : null}
      {sentence()}
      <div className={s.field}>
        <AnswerMask mask={mask} value={value} />
        <input
          ref={focusWithKeyboard}
          className={`${s.answer} ${mask ? s.masked : ""}`}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={saving}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label={`Пропущенное слово ${profile.names.in}`}
          lang={profile.code}
        />
      </div>
      <QuietActions>
        <QuietButton disabled={saving} onClick={() => void answer("")}>
          Не знаю
        </QuietButton>
      </QuietActions>
      <Primary form={formId} disabled={!value.trim() || saving}>
        {saving ? "Сохраняем…" : "Проверить"}
      </Primary>
    </form>
  );
}
