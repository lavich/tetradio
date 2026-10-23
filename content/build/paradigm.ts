/** Спряжение греческого глагола правилами; где правила не уверены — `null`, и таблица задаётся в карточке. */
import { stripAccent } from "../../src/domain/language.ts";
import type { Paradigm, VerbGroup } from "../../src/domain/types.ts";
import { hasParadigm } from "../../src/domain/verb-forms.ts";

export { hasParadigm };

const VOWELS = "αεηιουω";
const ACUTE = "́";
const base = (char: string) => stripAccent(char.normalize("NFD").replace(/̈/g, "").normalize("NFC"));
const isVowel = (char: string) => VOWELS.includes(base(char));
const accented = (char: string) => char.normalize("NFD").includes(ACUTE);
const flat = (value: string) => stripAccent(value.normalize("NFC"));

/** Позиции гласных ядер: у αι, ει, οι, ου, υι, αυ, ευ ядро — вторая буква, безударное ι перед гласной — не ядро. */
function nuclei(word: string): number[] {
  const chars = [...word];
  const out: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (!isVowel(chars[i])) continue;
    const next = chars[i + 1];
    const pair = next ? base(chars[i]) + base(next) : "";
    const split = next ? next.normalize("NFD").includes("̈") : true;
    if (!split && ["αι", "ει", "οι", "ου", "υι", "αυ", "ευ", "ηυ"].includes(pair) && !accented(chars[i])) {
      out.push(i + 1);
      i++;
      continue;
    }
    if (base(chars[i]) === "ι" && !accented(chars[i]) && next && isVowel(next) && i > 0 && !isVowel(chars[i - 1]))
      continue;
    out.push(i);
  }
  return out;
}

const stressIndex = (word: string) => [...word].findIndex(accented);

function stressAt(word: string, index: number): string {
  const chars = [...flat(word)];
  chars[index] = (chars[index] + ACUTE).normalize("NFC");
  return chars.join("");
}

/** Ударение на последнее ядро основы: «мы/вы» прошедшего. */
const stressLast = (stem: string) => {
  const last = nuclei(flat(stem)).at(-1);
  return last === undefined ? null : stressAt(stem, last);
};

function present(word: string): string[] | null {
  if (!/^\p{L}+$/u.test(word)) return null;
  const ends = (suffix: string) => word.endsWith(suffix);
  const stem = (n: number) => word.slice(0, word.length - n);
  if (ends("ιέμαι")) return ["ιέμαι", "ιέσαι", "ιέται", "ιόμαστε", "ιέστε", "ιούνται"].map((e) => stem(5) + e);
  if (ends("άμαι")) return ["άμαι", "άσαι", "άται", "όμαστε", "άστε", "ούνται"].map((e) => stem(4) + e);
  if (ends("ούμαι")) return ["ούμαι", "είσαι", "είται", "ούμαστε", "είστε", "ούνται"].map((e) => stem(5) + e);
  if (ends("ομαι") && stressIndex(stem(4)) >= 0) {
    const s = stem(4);
    return [s + "ομαι", s + "εσαι", s + "εται", flat(s) + "όμαστε", s + "εστε", s + "ονται"];
  }
  // Односложные (πάω) теряют ударение в формах: πας, πάμε — только явно.
  if (ends("άω") && !nuclei(stem(2)).length) return null;
  if (ends("άω")) return ["άω", "άς", "άει", "άμε", "άτε", "άνε"].map((e) => stem(2) + e);
  if (ends("ώ")) return ["ώ", "είς", "εί", "ούμε", "είτε", "ούν"].map((e) => stem(1) + e);
  if (ends("ω") && stressIndex(stem(1)) >= 0) {
    const s = stem(1);
    const before = [...s].at(-1)!;
    // Гласная перед -ω (λέω, ακούω, τρώω) спрягается иначе; λύω и -εύω — как обычные.
    if (isVowel(before) && !(base(before) === "υ" && !flat(s).endsWith("ου"))) return null;
    return ["ω", "εις", "ει", "ουμε", "ετε", "ουν"].map((e) => s + e);
  }
  return null;
}

/** Основа аориста без приращения (ε/η в начале или одна гласная внутри) — по основе будущего. */
function withoutAugment(aorist: string, future: string): string | null {
  const a = flat(aorist),
    f = flat(future);
  if (f.length >= 2 && /^[εη]/.test(a) && a.slice(1).startsWith(f.slice(0, 2)) && a.length - 1 >= f.length - 1)
    return a.slice(1);
  if (a.length !== f.length) return null;
  const differ = [...a].flatMap((char, i) => (char === f[i] ? [] : [i]));
  return differ.length === 1 && /[εη]/.test(a[differ[0]]) && isVowel(f[differ[0]]) ? f : null;
}

function past(first: string, future: string | undefined): string[] | null {
  if (!first.endsWith("α") || first.includes(" ")) return null;
  const stem = first.slice(0, -1);
  // Синизеза (ήπια, κατάπια): ударение «мы/вы» не выводится надёжно.
  if (flat(stem).endsWith("ι")) return null;
  // Ударная первая гласная пары (κορόιδεψα): при сдвиге ударения нужна диерезис — только явно.
  if (/[άέόύ][ιυ]/u.test(stem)) return null;
  const at = stressIndex(stem);
  const last = nuclei(stem).at(-1);
  if (at < 0 || last === undefined) return null;
  let plural = stem;
  if (at !== last) {
    if (!future) return null;
    plural = withoutAugment(stem, future) ?? stem;
  }
  const stressed = stressLast(plural);
  if (!stressed) return null;
  return [first, stem + "ες", stem + "ε", stressed + "αμε", stressed + "ατε", stem + "αν"];
}

/** Формы карточки «аор. έμεινα; буд. θα μείνω»: аорист или прошедшее и основа будущего. */
export function principal(forms: string): { past?: string; future?: string } {
  const out: { past?: string; future?: string } = {};
  for (const piece of forms.normalize("NFC").split(";")) {
    const match = /^\s*(аор|прош|буд)\.\s*(.+?)\s*$/u.exec(piece);
    if (!match) continue;
    if (match[1] === "буд") {
      const form = match[2].replace(/^θα\s+/u, "");
      if (/[ωώ]$/.test(form) && !form.includes(" ")) out.future = form.slice(0, -1);
    } else out.past = match[2];
  }
  return out;
}

export function conjugate(word: string, forms: string): Paradigm | null {
  const { past: first, future } = principal(forms);
  if (!first) return null;
  const now = present(word.normalize("NFC"));
  const then = past(first, future);
  return now && then ? { present: now, past: then } : null;
}

/** Группа по формам «я», «ты», «мы»; сжатое настоящее (λες, ακούς) и είμαι правилам не поддаются — `null`. */
export function verbGroup(present: string[]): VerbGroup | null {
  const [i, you, , we] = present.map((form) => form.normalize("NFC"));
  if (i.endsWith("μαι") && i !== "είμαι") return "mid";
  if (you.endsWith("άς")) return "B1";
  if ((you.endsWith("είς") || you.endsWith("εις")) && we.endsWith("ούμε")) return "B2";
  if (i.endsWith("ω") && you.endsWith("εις") && we.endsWith("ουμε")) return "A";
  return null;
}

/** Только окончание первой формы прошедшего: смену основы при правильном окончании (έδωσα) правило не видит. */
export function irregularPast(headword: string, past: string): boolean {
  const form = flat(past).toLowerCase();
  const word = flat(headword).toLowerCase();
  if (word.endsWith("μαι")) return !/(?:θηκα|τηκα)$/u.test(form);
  if (/(?:σα|ξα|ψα)$/u.test(form)) return false;
  const stem = word.replace(/(?:αω|ω)$/u, "");
  return form !== `${stem}α` && form !== `ε${stem}α`;
}
