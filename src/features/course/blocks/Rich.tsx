import type { ReactNode } from "react";
import type { WordMark } from "../../../content/schema";
import { Marked } from "../WordTaps";

export function paragraphs(text: string) {
  const out: { from: number; to: number }[] = [];
  const gap = /\n\s*\n/g;
  let from = 0;
  for (let match = gap.exec(text); match; match = gap.exec(text)) {
    out.push({ from, to: match.index });
    from = match.index + match[0].length;
  }
  out.push({ from, to: text.length });
  return out;
}

/** `**…**` — выделение; остальной текст печатью. */
export function Rich({ text, from, to, marks }: { text: string; from: number; to: number; marks: WordMark[] }) {
  const parts: ReactNode[] = [];
  const bold = /\*\*([^*]+)\*\*/g;
  bold.lastIndex = from;
  let at = from;
  for (let match = bold.exec(text); match && match.index < to; match = bold.exec(text)) {
    if (match.index + match[0].length > to) break;
    if (match.index > at) parts.push(<Marked key={at} text={text} marks={marks} from={at} to={match.index} />);
    parts.push(
      <strong key={match.index}>
        <Marked text={text} marks={marks} from={match.index + 2} to={match.index + match[0].length - 2} />
      </strong>,
    );
    at = match.index + match[0].length;
  }
  if (at < to) parts.push(<Marked key={at} text={text} marks={marks} from={at} to={to} />);
  return <>{parts}</>;
}
