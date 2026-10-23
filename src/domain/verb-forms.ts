import { stripAccent, type Language } from "./language.ts";

export interface PrincipalPart {
  form: string;
  label: string;
}

const LABELS: Record<string, string> = {
  аор: "было",
  прош: "было",
  буд: "будет",
  повел: "делай",
  прич: "причастие",
};

/** Глагол с лицами: безличные (βρέχει, πρέπει) спрягаются только в третьем лице, таблицы у них нет. */
export const hasParadigm = (word: string, forms: string | undefined) =>
  /(?:ω|ώ|μαι)$/u.test(word.normalize("NFC")) && !!forms && /(?:^|;)\s*(?:аор|прош)\./u.test(forms);

/** Ряд «μένω → έμεινα → θα μείνω» из строки форм карточки; без глагольных помет (мн. ч., роды) — `null`. */
export function principalParts(headword: string, forms: string | undefined): PrincipalPart[] | null {
  if (!forms) return null;
  const parts: PrincipalPart[] = [];
  for (const piece of forms.normalize("NFC").split(/[;,]/)) {
    const match = /^\s*(аор|прош|буд|повел|прич)\.\s*(.*?)\s*$/u.exec(piece);
    if (!match) continue;
    if (/\p{L}/u.test(match[2])) parts.push({ form: match[2], label: LABELS[match[1]] });
  }
  return parts.length ? [{ form: headword, label: "сейчас" }, ...parts] : null;
}

/** Личные окончания по местам таблицы, без ударения: выделяется только окончание своего лица и времени. */
export const ENDINGS = {
  present: [
    ["ω", "ομαι", "αμαι", "ουμαι", "ιεμαι"],
    ["εις", "ας", "εσαι", "ασαι", "εισαι", "ιεσαι"],
    ["ει", "αει", "α", "εται", "αται", "ειται", "ιεται"],
    ["ουμε", "αμε", "ομαστε", "ουμαστε", "ιομαστε"],
    ["ετε", "ειτε", "ατε", "εστε", "αστε", "ειστε", "ιεστε"],
    ["ουν", "ανε", "ονται", "ουνται", "ιουνται"],
  ],
  past: [["α"], ["ες"], ["ε"], ["αμε"], ["ατε"], ["αν"]],
  imperative: ["ε", "α", "ου", "ετε", "ατε"],
};
const SLOTS: Record<string, string[]> = {
  сейчас: ENDINGS.present[0],
  было: ENDINGS.past[0],
  будет: ENDINGS.present[0],
  делай: ENDINGS.imperative,
};
export const endingsOf = (label: string): string[] => SLOTS[label] ?? [];

export function splitEnding(form: string, language: Language, endings: string[]): [string, string] {
  const text = form.normalize("NFC");
  if (language !== "el") return [text, ""];
  const word = /\p{L}+$/u.exec(text);
  if (!word) return [text, ""];
  const flat = stripAccent(word[0]).toLowerCase();
  const ending = [...endings]
    .sort((a, b) => b.length - a.length)
    .find((candidate) => flat.endsWith(candidate) && flat.length > candidate.length);
  if (!ending) return [text, ""];
  const at = text.length - ending.length;
  return [text.slice(0, at), text.slice(at)];
}
