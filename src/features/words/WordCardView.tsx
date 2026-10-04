import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Example, Word } from "../../domain/types";
import { coreWord, stressNote, stressPosition } from "../../domain/phonetics";
import { playWord, speakPhrase, useAudioKind, useGreekVoice } from "../../shared/audio";
import { useAssetSource, useAssetUrl, useWord } from "../../shared/store";
import ui from "../../shared/ui.module.css";
import wordCss from "../../shared/word.module.css";
import { cx } from "../../shared/cx";

export const QUIET_SPEAK =
  "size-11 rounded-full bg-card text-primary hover:bg-soft hover:text-primary [&_svg:not([class*='size-'])]:size-5";

/** Плашка разбора или примера; `bare` — без своей карточки, когда она уже стоит на листе. */
function Box({ bare, label, children }: { bare?: boolean; label?: string; children: ReactNode }) {
  if (bare)
    return (
      <div className={wordCss.bare} role={label ? "group" : undefined} aria-label={label}>
        {children}
      </div>
    );
  return (
    <Card className="mb-3 bg-soft ring-0" aria-label={label}>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function WordArt({ word, hidden, className }: { word: Word; hidden?: boolean; className?: string }) {
  const url = useAssetUrl(hidden ? undefined : word.imageAssetId);
  if (hidden || !word.imageAssetId) return null;
  if (!url) return <div className={cx(wordCss.art, className)} aria-hidden />;
  return <img className={cx(wordCss.art, className)} src={url} alt="" role="presentation" data-testid="word-art" />;
}

/** `quiet` — тихая кнопка в строке листа занятия: обводка и чернила вместо заливки. */
export function SpeakButton({
  word,
  label = "Послушать слово",
  quiet,
}: {
  word: Word;
  label?: string;
  quiet?: boolean;
}) {
  const kind = useAudioKind(word);
  const source = useAssetSource();
  const [failed, setFailed] = useState<"none" | "error" | null>(null);
  // Кнопка стоит в строке справа от слова: подпись держим под кнопкой узкой колонкой,
  // иначе в flex-строке она сжимает слово и IPA до нулевой ширины.
  return (
    <div className={wordCss.speakBox}>
      <Button
        size="icon-xl"
        variant={quiet ? "outline" : "default"}
        className={quiet ? QUIET_SPEAK : "size-14 rounded-full [&_svg:not([class*='size-'])]:size-6.5"}
        disabled={kind === "none"}
        aria-label={kind === "none" ? "Озвучка недоступна" : label}
        onClick={() =>
          playWord(word, source).then((result) => setFailed(result === "none" || result === "error" ? result : null))
        }
      >
        <Volume2 aria-hidden />
      </Button>
      {(kind === "none" || failed === "none") && (
        <span className={ui.note}>Озвучка недоступна: нет файла и греческого голоса</span>
      )}
      {failed === "error" && (
        <span className={ui.note} role="status">
          Не удалось воспроизвести. Нажмите ещё раз.
        </span>
      )}
    </div>
  );
}

/** Верх карточки слова: иллюстрация, написание с IPA, озвучка и перевод — общий для экрана слова и просмотра по ссылке. */
export function WordSummary({ word }: { word: Word }) {
  return (
    <>
      <WordArt word={word} />
      <div className={cx(ui.row, ui.between)} style={{ margin: "16px 0 2px", gap: 12 }}>
        <div className={ui.grow} style={{ minWidth: 0 }}>
          <p className={wordCss.greek} style={{ margin: 0 }}>
            {word.greek}
          </p>
          {word.ipa && (
            <p className={wordCss.ipa} style={{ margin: 0 }}>
              {word.ipa}
            </p>
          )}
        </div>
        <SpeakButton word={word} />
      </div>
      <p style={{ fontSize: 19, margin: "8px 0 14px" }}>{word.russian}</p>
    </>
  );
}

export function ReadingNotes({ word, bare }: { word: Word; bare?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const segments = [...word.segments].filter((s) => s.start >= 0).sort((a, b) => a.start - b.start);
  const parts: { text: string; index: number | null }[] = [];
  let cursor = 0;
  segments.forEach((segment, index) => {
    if (segment.start < cursor) return;
    if (segment.start > cursor) parts.push({ text: word.greek.slice(cursor, segment.start), index: null });
    parts.push({ text: segment.text, index });
    cursor = segment.start + segment.text.length;
  });
  if (cursor < word.greek.length) parts.push({ text: word.greek.slice(cursor), index: null });
  const note = stressNote(word.greek);
  const core = coreWord(word.greek);
  const accent = stressPosition(word.greek);
  const active = open === null ? null : segments[open];
  if (!note && !segments.length && !word.note) return null;
  return (
    <Box bare={bare} label="Как читается">
      {note && (
        <p className={ui.small} style={{ margin: segments.length ? "0 0 10px" : 0 }}>
          {note}:{" "}
          <b style={{ fontSize: 19 }}>
            {accent ? (
              <>
                {core.slice(0, accent.start)}
                <span className={wordCss.target}>{core.slice(accent.start, accent.start + accent.length)}</span>
                {core.slice(accent.start + accent.length)}
              </>
            ) : (
              core
            )}
          </b>
        </p>
      )}
      {word.note && (
        <p className={cx(ui.small)} style={{ margin: segments.length ? "0 0 10px" : 0 }}>
          {word.note}
        </p>
      )}
      {segments.length > 0 && (
        <>
          <p style={{ fontSize: 22, margin: "0 0 6px" }}>
            {parts.map((part, i) =>
              part.index === null ? (
                <span key={i}>{part.text}</span>
              ) : (
                <button
                  key={i}
                  className={wordCss.seg}
                  aria-expanded={open === part.index}
                  onClick={() => setOpen(open === part.index ? null : part.index)}
                >
                  {part.text}
                </button>
              ),
            )}
          </p>
          <p className={ui.note} style={{ margin: 0 }}>
            {active ? (
              <>
                «{active.text}» → [{active.ipa}]. {active.explanation}
              </>
            ) : (
              "Нажмите на подчёркнутое сочетание букв."
            )}
          </p>
        </>
      )}
    </Box>
  );
}

/**
 * Пример слова. Размеченные при подготовке отрезки нажимаются и показывают перевод строкой под предложением.
 * `linkFrom` — карточка, в которой показан пример: с ним строка предлагает открыть связанную карточку
 * (кроме неё самой); без него, внутри тренировки, строка показывает только перевод и никуда не уводит.
 */
export function ExampleBox({
  example,
  title = "В контексте",
  linkFrom,
  bare,
}: {
  example: Example;
  title?: string;
  linkFrom?: string;
  bare?: boolean;
}) {
  const at = example.target ? example.greek.indexOf(example.target) : -1;
  const voice = useGreekVoice();
  const [open, setOpen] = useState<number | null>(null);
  const glosses = example.glosses ?? [];
  const active = open === null ? undefined : glosses[open];
  const linkId = linkFrom !== undefined && active?.wordId !== linkFrom ? active?.wordId : undefined;
  const linked = useWord(linkId);
  /** Кусок предложения с выделением слова-цели там, где он с ним пересекается. */
  const piece = (from: number, to: number) => {
    const lo = Math.max(from, at),
      hi = Math.min(to, at + example.target.length);
    if (at < 0 || lo >= hi) return example.greek.slice(from, to);
    return (
      <>
        {example.greek.slice(from, lo)}
        <span className={wordCss.target}>{example.greek.slice(lo, hi)}</span>
        {example.greek.slice(hi, to)}
      </>
    );
  };
  const parts: ReactNode[] = [];
  let cursor = 0;
  glosses.forEach((gloss, index) => {
    if (gloss.start > cursor) parts.push(<Fragment key={`t${index}`}>{piece(cursor, gloss.start)}</Fragment>);
    parts.push(
      <button
        key={`g${index}`}
        className={cx(wordCss.gloss, open === index && wordCss.glossOpen)}
        aria-expanded={open === index}
        onClick={() => setOpen(open === index ? null : index)}
      >
        {piece(gloss.start, gloss.start + gloss.length)}
      </button>,
    );
    cursor = gloss.start + gloss.length;
  });
  parts.push(<Fragment key="end">{piece(cursor, example.greek.length)}</Fragment>);
  return (
    <Box bare={bare}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {!bare && (
            <p className={ui.note} style={{ margin: "0 0 6px" }}>
              {title}
            </p>
          )}
          <p
            className={bare ? wordCss.printLine : undefined}
            style={bare ? undefined : { fontSize: 20, margin: "0 0 4px" }}
          >
            {parts}
          </p>
          {glosses.length > 0 && (
            <p className={ui.small} style={{ margin: "0 0 4px" }} aria-live="polite" data-testid="example-gloss">
              {active && (
                <>
                  <b>{example.greek.slice(active.start, active.start + active.length)}</b> — {active.russian}
                  {linked && (
                    <>
                      {" "}
                      <Link to={`/words/${linked.id}`}>Открыть карточку</Link>
                    </>
                  )}
                </>
              )}
            </p>
          )}
          <p className={ui.note} style={{ margin: 0 }}>
            {example.russian}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-lg"
          className="-mt-1 shrink-0 text-primary hover:bg-primary/10"
          disabled={!voice}
          aria-label={voice ? "Послушать предложение" : "Озвучка предложения недоступна: нет греческого голоса"}
          onClick={() => speakPhrase(example.greek)}
        >
          <Volume2 />
        </Button>
      </div>
    </Box>
  );
}
