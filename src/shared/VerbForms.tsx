import { Fragment, useState } from "react";
import type { Paradigm } from "../domain/types";
import { ENDINGS, endingsOf, principalParts, splitEnding } from "../domain/verb-forms";
import { playText, type PlayResult } from "./audio";
import { noVoice, useProfile } from "./language";
import css from "./verb-forms.module.css";

function Form({ form, endings, onSay }: { form: string; endings: string[]; onSay?: (form: string) => void }) {
  const { code } = useProfile();
  const [stem, ending] = splitEnding(form, code, endings);
  const text = (
    <>
      {stem}
      {ending && <span className={css.ending}>{ending}</span>}
    </>
  );
  const shown = (
    <span className={css.form} lang={code}>
      {text}
    </span>
  );
  if (!onSay) return shown;
  return (
    <button type="button" className={css.say} aria-label={`Произнести: ${form}`} onClick={() => onSay(form)}>
      {shown}
    </button>
  );
}

export function useSay() {
  const profile = useProfile();
  const [result, setResult] = useState<PlayResult>();
  const say = (form: string) => {
    setResult(undefined);
    void playText(form, undefined, profile).then(setResult);
  };
  const note =
    result === "none" || result === "error" ? (
      <p className={css.note}>{result === "none" ? noVoice(profile) : "Не удалось воспроизвести произношение."}</p>
    ) : null;
  return { say, note };
}

export function VerbForms({
  headword,
  forms,
  labels = true,
  onSay,
  className,
}: {
  headword: string;
  forms: string;
  labels?: boolean;
  onSay?: (form: string) => void;
  className?: string;
}) {
  const { code } = useProfile();
  const parts = principalParts(headword, forms);
  if (!parts)
    return (
      <span className={className} lang={code}>
        {forms}
      </span>
    );
  return (
    <span className={`${css.row} ${className ?? ""}`} data-testid="verb-forms">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span className={css.arrow} aria-hidden>
              →
            </span>
          )}
          <span className={css.part}>
            <Form form={part.form} endings={endingsOf(part.label)} onSay={onSay} />
            {labels && <span className={css.label}>{part.label}</span>}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

const PERSONS = ["я", "ты", "он, она", "мы", "вы", "они"];

export function ParadigmTable({ paradigm, onSay }: { paradigm: Paradigm; onSay: (form: string) => void }) {
  return (
    <details className={css.details} data-testid="paradigm">
      <summary className={css.summary}>Все формы</summary>
      <div className={css.scroll}>
        <table className={css.table}>
          <thead>
            <tr>
              <td />
              <th scope="col">сейчас</th>
              <th scope="col">было</th>
            </tr>
          </thead>
          <tbody>
            {PERSONS.map((person, index) => (
              <tr key={person}>
                <th scope="row">{person}</th>
                <td>
                  <Form form={paradigm.present[index]} endings={ENDINGS.present[index]} onSay={onSay} />
                </td>
                <td>
                  <Form form={paradigm.past[index]} endings={ENDINGS.past[index]} onSay={onSay} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
