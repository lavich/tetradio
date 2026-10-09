import { Volume2, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { BlockMarks, WordMark } from "../../content/schema";
import { languageOfText } from "../../domain/language";
import { playText, type PlayResult } from "../../shared/audio";
import { noVoice, useProfile } from "../../shared/language";
import type { TapCard } from "../../storage/course";
import css from "./word-taps.module.css";

const HINT_KEY = "word-taps-hint";
const hintSeen = () => {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true; // хранилище закрыто — подсказку о возможности не навязываем при каждом открытии
  }
};

interface Open {
  card: TapCard;
  anchor: HTMLElement;
  keyboard: boolean;
  point?: { x: number; y: number };
  played: Promise<PlayResult>;
  seq: number;
}
interface Taps {
  marks: BlockMarks;
  cards: Map<string, TapCard>;
  open: Open | null;
  show: (next: Omit<Open, "seq">) => void;
  close: () => void;
  hint: boolean;
  dismissHint: () => void;
}
const TapsContext = createContext<Taps | null>(null);

export function WordTaps({
  marks,
  cards,
  page,
  children,
}: {
  marks: BlockMarks;
  cards: Map<string, TapCard>;
  page: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const [hint, setHint] = useState(() => !hintSeen());
  const dismissHint = useCallback(() => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* хранилище недоступно */
    }
  }, []);
  const close = useCallback(() => setOpen(null), []);
  const seq = useRef(0);
  const show = useCallback(
    (next: Omit<Open, "seq">) => {
      setOpen({ ...next, seq: ++seq.current });
      dismissHint();
    },
    [dismissHint],
  );
  useEffect(() => setOpen(null), [page]);
  useInkStroke();
  const value = useMemo(
    () => ({ marks, cards, open, show, close, hint, dismissHint }),
    [marks, cards, open, show, close, hint, dismissHint],
  );
  return (
    <TapsContext.Provider value={value}>
      {children}
      {open ? <WordSheet key={open.seq} open={open} onClose={close} /> : null}
    </TapsContext.Provider>
  );
}

const useTaps = () => useContext(TapsContext);
export const useFieldMarks = (blockId: string, field: string): WordMark[] => useTaps()?.marks[blockId]?.[field] ?? [];

/** SVG в `background-image` не видит CSS-переменных, а чернила приходят из темы Telegram: штрих перекрашивается здесь. */
const STROKE = "M0 4.2 Q8 2.6 22 3.6 L100 5.4 Q60 6.6 22 6.8 Q6 7.4 0 4.2Z";
function useInkStroke() {
  useEffect(() => {
    const root = document.documentElement;
    const paint = () => {
      const probe = document.createElement("span");
      probe.style.color = "var(--primary)";
      document.body.append(probe);
      const ink = getComputedStyle(probe).color;
      probe.remove();
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 10' preserveAspectRatio='none'><path d='${STROKE}' fill='${ink}' fill-opacity='0.8'/></svg>`;
      const value = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      if (root.style.getPropertyValue("--tap-stroke") !== value) root.style.setProperty("--tap-stroke", value);
    };
    paint();
    const watch = new MutationObserver(paint);
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => {
      watch.disconnect();
      root.style.removeProperty("--tap-stroke");
    };
  }, []);
}

function TapWord({ card, stroke, gloss, text }: { card: TapCard; stroke?: boolean; gloss?: boolean; text: string }) {
  const taps = useTaps()!;
  const profile = useProfile();
  const ref = useRef<HTMLSpanElement>(null);
  const active = taps.open?.anchor === ref.current && !!ref.current;
  const activate = (keyboard: boolean, point?: { x: number; y: number }) => {
    if (active) return taps.close();
    // Звучит карточка, а не форма из текста: то же произношение, что в словах урока и в подсказке.
    const played = playText(card.greek, card.audioAssetId, profile);
    taps.show({ card, anchor: ref.current!, keyboard, point, played });
  };
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      lang={profile.code}
      aria-label={`Произнести и перевести: ${text}`}
      aria-haspopup="dialog"
      aria-expanded={active}
      className={[css.tap, gloss ? css.gloss : "", stroke ? css.stroke : "", active ? css.tapOn : ""].join(" ")}
      onClick={(event) => activate(false, { x: event.clientX, y: event.clientY })}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate(true);
      }}
    >
      {text}
    </span>
  );
}

export interface GlossRange {
  start: number;
  length: number;
  text: string;
  russian: string;
}
export function Marked({
  text,
  marks,
  from = 0,
  to = text.length,
  glosses = [],
}: {
  text: string;
  marks: WordMark[];
  from?: number;
  to?: number;
  glosses?: GlossRange[];
}) {
  const taps = useTaps();
  const ranges = useMemo(() => {
    const inside = (start: number, length: number) => start >= from && start + length <= to;
    const own = glosses
      .filter((gloss) => inside(gloss.start, gloss.length))
      .map((gloss) => ({ gloss, mark: marks.find((m) => m.start === gloss.start && m.length === gloss.length) }));
    const glossAt = new Set(own.map(({ gloss }) => gloss.start));
    const words = marks.filter((mark) => inside(mark.start, mark.length) && !glossAt.has(mark.start));
    return [
      ...own.map(({ gloss, mark }) => ({ start: gloss.start, length: gloss.length, gloss, mark })),
      ...words.map((mark) => ({ start: mark.start, length: mark.length, gloss: undefined, mark })),
    ].sort((a, b) => a.start - b.start);
  }, [marks, glosses, from, to]);
  if (!taps) return <>{text.slice(from, to)}</>;
  const nodes: ReactNode[] = [];
  let at = from;
  for (const range of ranges) {
    if (range.start < at) continue;
    const card: TapCard | undefined = range.mark
      ? taps.cards.get(range.mark.ref)
      : { ref: `gloss:${range.start}`, greek: range.gloss!.text, russian: range.gloss!.russian };
    if (!card) continue;
    if (range.start > at) nodes.push(text.slice(at, range.start));
    const surface = text.slice(range.start, range.start + range.length);
    nodes.push(
      <TapWord
        key={range.start}
        card={card}
        gloss={!!range.gloss}
        stroke={!range.gloss && range.mark?.kind === "lesson" && range.mark.first}
        text={surface}
      />,
    );
    at = range.start + range.length;
  }
  if (at < to) nodes.push(text.slice(at, to));
  return <>{nodes}</>;
}

export function TapHint() {
  const taps = useTaps();
  if (!taps?.hint || !Object.keys(taps.marks).length) return null;
  return (
    <p className={css.tapHint} role="note">
      <span>
        Нажмите на <span className={`${css.stroke} ${css.hintWord}`}>слово</span> — услышите его и увидите перевод
      </span>
      <button type="button" className={css.tapHintClose} aria-label="Скрыть подсказку" onClick={taps.dismissHint}>
        <X aria-hidden size={16} />
      </button>
    </p>
  );
}

const GAP = 10;
const EDGE = 8;
function WordSheet({ open, onClose }: { open: Open; onClose: () => void }) {
  const { card, anchor, keyboard, point, played } = open;
  const profile = languageOfText(card.greek);
  const sheet = useRef<HTMLDivElement>(null);
  const speak = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [place, setPlace] = useState<{ left: number; top: number; width: number; arrow: number; below: boolean }>();
  const [result, setResult] = useState<PlayResult>();
  useEffect(() => {
    let live = true;
    void played.then((value) => live && setResult(value));
    return () => {
      live = false;
    };
  }, [played]);

  useLayoutEffect(() => {
    const node = sheet.current;
    if (!node) return;
    const rects = [...anchor.getClientRects()];
    // Слово, перенесённое на две строки: хвостик — к той части, на которую нажали.
    const rect =
      (point &&
        rects.find(
          (r) => point.y >= r.top && point.y <= r.bottom && point.x >= r.left - 2 && point.x <= r.right + 2,
        )) ??
      rects[0] ??
      anchor.getBoundingClientRect();
    const page = anchor.closest("article")?.getBoundingClientRect();
    const minX = Math.max(EDGE, (page?.left ?? 0) + EDGE);
    const maxX = Math.min(window.innerWidth - EDGE, (page?.right ?? window.innerWidth) - EDGE);
    const width = Math.min(300, maxX - minX);
    node.style.width = `${width}px`;
    const height = node.offsetHeight;
    const center = rect.left + rect.width / 2;
    const left = Math.min(Math.max(center - width / 2, minX), maxX - width);
    const header = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const below = rect.top - GAP - height < header + EDGE;
    const top = below ? rect.bottom + GAP : rect.top - GAP - height;
    setPlace({ left, top, width, below, arrow: Math.min(Math.max(center - left, 18), width - 18) });
  }, [anchor, point]);

  useEffect(() => {
    const startY = window.scrollY;
    const finish = (restore: boolean) => {
      onClose();
      if (restore) anchor.focus({ preventScroll: true });
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sheet.current?.contains(target) && !anchor.contains(target)) finish(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") finish(true);
    };
    // Мелкий сдвиг от касания — не прокрутка.
    const onScroll = () => Math.abs(window.scrollY - startY) > 8 && finish(false);
    const onResize = () => finish(false);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [anchor, keyboard, onClose]);

  const placed = !!place;
  useEffect(() => {
    // Скрытый до расчёта положения лист фокус не принимает.
    if (keyboard && placed) speak.current?.focus({ preventScroll: true });
  }, [keyboard, placed]);

  const again = () => {
    setResult(undefined);
    void playText(card.greek, card.audioAssetId, profile).then(setResult);
  };
  const forms = card.forms && profile.script.test(card.forms) ? card.forms : undefined;
  return createPortal(
    <div
      ref={sheet}
      role="dialog"
      aria-labelledby={titleId}
      className={css.sheetTip}
      data-side={place?.below ? "below" : "above"}
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        visibility: place ? "visible" : "hidden",
        ["--arrow" as string]: `${place?.arrow ?? 24}px`,
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !sheet.current?.contains(next) && !anchor.contains(next)) onClose();
      }}
    >
      {card.lesson ? <p className={css.tipFrom}>Из урока {card.lesson}</p> : null}
      <div className={css.tipHead}>
        <div className="min-w-0">
          <p id={titleId} className={css.tipGreek} lang={profile.code}>
            {card.greek}
          </p>
          {card.ipa ? <p className={css.tipIpa}>{card.ipa}</p> : null}
        </div>
        <button ref={speak} type="button" className={css.tipSpeak} aria-label="Ещё раз" title="Ещё раз" onClick={again}>
          <Volume2 aria-hidden size={20} />
        </button>
      </div>
      {card.russian ? <p className={css.tipRu}>{card.russian}</p> : null}
      {forms ? (
        <p className={css.tipForms} lang={profile.code}>
          {forms}
        </p>
      ) : null}
      {result === "none" ? <p className={css.tipNote}>{noVoice(profile)}</p> : null}
      {result === "error" ? <p className={css.tipNote}>Не удалось воспроизвести произношение.</p> : null}
    </div>,
    document.body,
  );
}
