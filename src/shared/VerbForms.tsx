import { Fragment, useId, useState } from "react";
import type { Paradigm, Word } from "../domain/types";
import { ENDINGS, endingsOf, principalParts, splitEnding } from "../domain/verb-forms";
import { playText, type PlayResult } from "./audio";
import { noVoice, useProfile } from "./language";
import css from "./verb-forms.module.css";

function Form({
  form,
  endings,
  onSay,
  labelId,
}: {
  form: string;
  endings: string[];
  onSay?: (form: string) => void;
  labelId?: string;
}) {
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
    <button type="button" className={css.say} aria-describedby={labelId} onClick={() => onSay(form)}>
      <span className="sr-only select-none">Произнести: </span>
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

const PLURAL = /^мн\.\s*/u;

/** Строка форм не-глагола: «мн.» звучит словом, а не буквами греческого голоса; повтор заглавного слова не звучит. */
function PlainForms({
  headword,
  forms,
  headwordShown,
  className,
}: {
  headword: string;
  forms: string;
  headwordShown: boolean;
  className?: string;
}) {
  const { code } = useProfile();
  if (!/\p{L}/u.test(forms))
    return (
      <span className={className} aria-hidden>
        {forms}
      </span>
    );
  const plural = PLURAL.exec(forms);
  const greek = plural ? forms.slice(plural[0].length) : forms;
  const [first, ...rest] = greek.split(/(?<=,)\s*/u);
  const repeatsHeadword =
    headwordShown && rest.length > 0 && first.slice(0, -1).normalize("NFC") === headword.normalize("NFC");
  return (
    <span className={className}>
      {headwordShown && <span className="sr-only select-none">, </span>}
      {plural && (
        <>
          <span aria-hidden>мн.</span>
          <span className="sr-only select-none">множественное число</span>{" "}
        </>
      )}
      {repeatsHeadword ? (
        <>
          <span lang={code} aria-hidden>
            {first}{" "}
          </span>
          <span lang={code}>{rest.join(" ")}</span>
        </>
      ) : (
        <span lang={code}>{greek}</span>
      )}
    </span>
  );
}

/** `headwordShown` — заглавное слово уже прочитано рядом (строка словарика): первая форма без кнопки скринридеру не повторяется. */
export function VerbForms({
  headword,
  forms,
  labels = true,
  headwordShown = false,
  onSay,
  className,
}: {
  headword: string;
  forms: string;
  labels?: boolean;
  headwordShown?: boolean;
  onSay?: (form: string) => void;
  className?: string;
}) {
  const id = useId();
  const hideHeadword = headwordShown && !onSay;
  const parts = principalParts(headword, forms);
  if (!parts)
    return <PlainForms headword={headword} forms={forms} headwordShown={headwordShown} className={className} />;
  return (
    <span className={`${css.row} ${className ?? ""}`} data-testid="verb-forms">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span className={css.arrow} aria-hidden>
              →
            </span>
          )}
          <span className={css.part} aria-hidden={(hideHeadword && index === 0) || undefined}>
            {!labels && index > 0 && <span className="sr-only select-none">, {part.label} </span>}
            <Form
              form={part.form}
              endings={endingsOf(part.label)}
              onSay={onSay}
              labelId={labels ? `${id}-${index}` : undefined}
            />
            {labels && (
              <span className={css.label} id={`${id}-${index}`} aria-hidden>
                {part.label}
              </span>
            )}
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

/** Ряд форм и таблица слова с одной строкой «нет голоса» на оба; `verbsOnly` — без строки форм не-глагола. */
export function WordForms({
  word,
  className,
  verbsOnly = false,
}: {
  word: Pick<Word, "greek" | "forms" | "paradigm">;
  className?: string;
  verbsOnly?: boolean;
}) {
  const { say, note } = useSay();
  if (verbsOnly && !word.paradigm && !principalParts(word.greek, word.forms)) return null;
  if (!word.forms && !word.paradigm) return null;
  return (
    <>
      {word.forms && (
        <div className={className}>
          <VerbForms headword={word.greek} forms={word.forms} onSay={say} />
        </div>
      )}
      {word.paradigm && <ParadigmTable paradigm={word.paradigm} onSay={say} />}
      {note}
    </>
  );
}
