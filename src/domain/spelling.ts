/** `fix` у замены — что должно стоять на месте лишнего: ручка пишет его над зачёркнутым. */
export interface DiffPart {
  type: "same" | "wrong" | "missing";
  text: string;
  fix?: string;
}
const normalizeForDiff = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");

export function diffChars(answer: string, expected: string): DiffPart[] {
  const a = [...normalizeForDiff(answer)],
    b = [...normalizeForDiff(expected)];
  const table = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      table[i][j] =
        a[i - 1].toLocaleLowerCase("el") === b[j - 1].toLocaleLowerCase("el")
          ? table[i - 1][j - 1]
          : 1 + Math.min(table[i - 1][j - 1], table[i - 1][j], table[i][j - 1]);
  const parts: DiffPart[] = [];
  const push = ({ type, text, fix }: DiffPart) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type && (last.fix === undefined) === (fix === undefined)) {
      last.text += text;
      if (fix !== undefined) last.fix += fix;
    } else parts.push(fix === undefined ? { type, text } : { type, text, fix });
  };
  let i = a.length,
    j = b.length;
  const steps: DiffPart[] = [];
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      a[i - 1].toLocaleLowerCase("el") === b[j - 1].toLocaleLowerCase("el") &&
      table[i][j] === table[i - 1][j - 1]
    ) {
      steps.push({ type: "same", text: b[j - 1] });
      i--;
      j--;
      continue;
    }
    if (i > 0 && j > 0 && table[i][j] === table[i - 1][j - 1] + 1) {
      steps.push({ type: "wrong", text: a[i - 1], fix: b[j - 1] });
      i--;
      j--;
      continue;
    }
    if (j > 0 && table[i][j] === table[i][j - 1] + 1) {
      steps.push({ type: "missing", text: b[j - 1] });
      j--;
      continue;
    }
    steps.push({ type: "wrong", text: a[i - 1] });
    i--;
  }
  for (const step of steps.reverse()) push(step);
  return parts;
}
