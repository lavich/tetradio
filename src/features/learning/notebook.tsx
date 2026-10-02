import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Rating } from "ts-fsrs";
import type { ReviewEvent, Session, SessionCard, SessionItem } from "../../domain/types";
import { plural } from "../../shared/format";
import { Tick } from "../../shared/Tick";
import { cx } from "../../shared/cx";
import s from "./session.module.css";

/**
 * Место листа в занятии: номер текущего задания и ячейка облачка, куда упражнение кладёт своё действие.
 * Без поставщика (отдельный рендер упражнения в тестах) или с `inline` действие остаётся прямо под листом.
 */
interface Place {
  number?: number;
  slot: HTMLElement | null;
  /** На широком экране облачко далеко от листа: «Проверить» ставим в карточку, рядом с ответом. */
  inline?: boolean;
}
const PlaceContext = createContext<Place | undefined>(undefined);
export const PlaceProvider = PlaceContext.Provider;

export function CloudAction({ children }: { children: ReactNode }) {
  const place = useContext(PlaceContext);
  if (!place || place.inline) return <div className={s.inlineAction}>{children}</div>;
  return place.slot ? createPortal(children, place.slot) : null;
}

/** Строка задания над листом: «5. Что значит это слово?»; сама формулировка — `prompt` для тестов и диктора. */
export function Instruction({ prompt, children }: { prompt: string; children?: ReactNode }) {
  const number = useContext(PlaceContext)?.number;
  return (
    <p className={s.instruction}>
      {number ? `${number}. ` : null}
      <span data-testid="prompt">{prompt}</span>
      {children}
    </p>
  );
}

const capital = (text: string) => text.charAt(0).toLocaleUpperCase("el") + text.slice(1);
/** «Πέμπτη, 1 Οκτωβρίου»: день плана занятия, а не момент открытия экрана. */
export function greekDate(day: string) {
  const parts = new Intl.DateTimeFormat("el-GR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).formatToParts(new Date(`${day}T12:00:00Z`));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${capital(get("weekday"))}, ${get("day")} ${get("month")}`;
}

export function PageHead({ day }: { day: string }) {
  return (
    <header className={s.head}>
      <p className={s.date} lang="el">
        {greekDate(day)}
      </p>
      <h1 className={s.title}>Повторение</h1>
    </header>
  );
}

const NEW: [string, string, string] = ["новая", "новых", "новых"];
const REVIEWS: [string, string, string] = ["повторение", "повторения", "повторений"];
/** Состав занятия по уникальным карточкам: новые и повторения; дополнительные попытки карточек не добавляют. */
export function compositionLine(items: SessionItem[]) {
  const fresh = new Set(items.filter((item) => item.isNew).map((item) => item.unitKey));
  const reviews = new Set(
    items.filter((item) => !item.isNew && !item.retryOf && !fresh.has(item.unitKey)).map((item) => item.unitKey),
  );
  return [
    fresh.size ? `${fresh.size} ${plural(fresh.size, NEW)}` : "",
    reviews.size ? `${reviews.size} ${plural(reviews.size, REVIEWS)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export type Mark = "correct" | "almost" | "wrong" | "skipped";
export interface DoneRow {
  id: string;
  unitKey: string;
  /** Что было дано в задании: греческое (печать, жирным) или перевод. */
  prompt: string;
  promptGreek: boolean;
  expected: string;
  expectedGreek: boolean;
  given: string;
  mark: Mark;
}

const sides = (card: SessionCard) =>
  card.kind === "word"
    ? { greek: card.word.greek, meaning: card.word.russian }
    : { greek: card.phrase.text, meaning: card.phrase.translation ?? "" };

/** «Почти» хранится оценкой Hard при `correct: false`: так её записывает `gradeFor`. */
export const markOf = (event: Pick<ReviewEvent, "correct" | "rating">): Mark =>
  event.correct ? "correct" : event.rating === Rating.Hard ? "almost" : "wrong";

/** Строки сделанного по порядку занятия: только отвеченные и пропущенные задания. */
export function doneRows(session: Pick<Session, "items">, events: Map<string, ReviewEvent>): DoneRow[] {
  return session.items.flatMap((item): DoneRow[] => {
    const event = item.eventId ? events.get(item.eventId) : undefined;
    if (!event && !item.skipped) return [];
    const { greek, meaning } = sides(item.card);
    // В аудировании и письме дан перевод или звук, а ответ — греческий; в узнавании наоборот.
    const towardGreek = item.type === "listening" || item.type === "assembly" || item.type === "spelling";
    return [
      {
        id: item.id,
        unitKey: item.unitKey,
        prompt: towardGreek ? meaning : greek,
        promptGreek: !towardGreek,
        expected: towardGreek ? greek : meaning,
        expectedGreek: towardGreek,
        given: event?.answer ?? "",
        mark: event ? markOf(event) : "skipped",
      },
    ];
  });
}

const MARK_LABEL: Record<Mark, string> = {
  correct: "верно",
  almost: "почти",
  wrong: "с исправлением",
  skipped: "пропущено",
};

function Answer({ row }: { row: DoneRow }) {
  const lang = row.expectedGreek ? "el" : undefined;
  const expected = (
    <em className={s.ink} lang={lang}>
      {row.expected || "—"}
    </em>
  );
  if (row.mark === "skipped") return <span className={s.quiet}>пропущено</span>;
  if (row.mark === "correct")
    return (
      <em className={s.ink} lang={lang}>
        {row.given || row.expected}
      </em>
    );
  if (!row.given)
    return (
      <>
        {expected} <span className={s.penNote}>не знаю</span>
      </>
    );
  return (
    <>
      <s className={row.mark === "almost" ? s.struckAlmost : s.struck} lang={lang}>
        <span className="sr-only">ответ </span>
        {row.given}
      </s>{" "}
      <span className="sr-only">верно </span>
      {expected}
    </>
  );
}

export function DoneList({
  rows,
  folded,
  onToggle,
}: {
  rows: DoneRow[];
  /** `undefined` — сворачивать нечего (широкий экран или итог). */
  folded?: boolean;
  onToggle?: () => void;
}) {
  if (!rows.length) return null;
  const toggle = onToggle && folded !== undefined && (
    <button type="button" className={s.fold} aria-expanded={!folded} onClick={onToggle}>
      Сделано {rows.length} — {folded ? "показать" : "скрыть"}
    </button>
  );
  return (
    <section className={s.done} aria-label="Сделано">
      {toggle}
      {!folded && (
        <ol className={s.doneList} data-done-list>
          {rows.map((row, index) => (
            <li key={row.id} className={cx(s.doneRow, row.mark === "skipped" && s.skipped)}>
              <span className={s.doneNumber}>{index + 1}.</span>
              <span className={s.doneText}>
                {row.promptGreek ? <b lang="el">{row.prompt}</b> : <span>{row.prompt}</span>} — <Answer row={row} />
              </span>
              {row.mark === "correct" || row.mark === "almost" ? (
                <Tick className={cx(s.doneMark, row.mark === "almost" && s.almost)} label={MARK_LABEL[row.mark]} />
              ) : (
                <span className="sr-only">{MARK_LABEL[row.mark]}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const WIDE = "(min-width: 900px)";
/** Две колонки от 900 px: там список сделанного не сворачивается. */
export function useWide() {
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(WIDE).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(WIDE);
    const change = () => setWide(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return wide;
}
