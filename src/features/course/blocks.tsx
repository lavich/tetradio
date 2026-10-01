import { Mic, Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type {
  ExerciseBlock,
  ExplanationBlock,
  ListeningBlock,
  ReadingBlock,
  SpeakingBlock,
  WritingBlock,
} from "../../content/course";
import { glossSpans } from "../../content/course";
import type { WordMark } from "../../content/schema";
import { scoreExercise, spokenChoice, wordCount, type ItemResult } from "../../domain/course";
import { speakPhrase } from "../../shared/audio";
import type { BlockProgress } from "../../domain/types";
import { playDialogue, stopDialogue, type Rate } from "../../shared/dialogue";
import type { BlockPatch } from "../../storage/course";
import css from "./course.module.css";
import { Tick } from "../../shared/Tick";
import { Marked, useFieldMarks } from "./WordTaps";

function paragraphs(text: string) {
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
function Rich({ text, from, to, marks }: { text: string; from: number; to: number; marks: WordMark[] }) {
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

export function Explanation({ block }: { block: ExplanationBlock }) {
  const marks = useFieldMarks(block.id, "body");
  return (
    <>
      {block.title ? <h3 className={css.blockTitle}>{block.title}</h3> : null}
      {paragraphs(block.body).map(({ from, to }) => (
        <p key={from} className={css.print}>
          <Rich text={block.body} from={from} to={to} marks={marks} />
        </p>
      ))}
      {block.table ? (
        <table className={css.table}>
          {block.table.columns ? (
            <thead>
              <tr>
                {block.table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {block.table.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, at) => (
                  <td key={at}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

export function Reading({ block }: { block: ReadingBlock }) {
  const marks = useFieldMarks(block.id, "text");
  const glosses = glossSpans(block.text, block.glosses).map(({ start, length, gloss }) => ({
    start,
    length,
    text: gloss.text,
    russian: gloss.russian,
  }));
  return (
    <>
      <h3 className={`${css.blockTitle} ${css.greek}`} lang="el">
        {block.title}
      </h3>
      <p className={css.reading} lang="el">
        <Marked text={block.text} marks={marks} glosses={glosses} />
      </p>
      {block.glosses?.length ? <p className={css.instruction}>Подчёркнутые слова — нажмите для перевода.</p> : null}
    </>
  );
}

function Line({ blockId, index, text }: { blockId: string; index: number; text: string }) {
  return <Marked text={text} marks={useFieldMarks(blockId, `transcript.${index}`)} />;
}
function Model({ blockId, text }: { blockId: string; text: string }) {
  return (
    <p className={css.model} lang="el">
      <Marked text={text} marks={useFieldMarks(blockId, "model")} />
    </p>
  );
}

export function Listening({ block, revealed }: { block: ListeningBlock; revealed: boolean }) {
  const [plays, setPlays] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [line, setLine] = useState(-1);
  const [rate, setRate] = useState<Rate>("normal");
  const [problem, setProblem] = useState("");
  const [shown, setShown] = useState(false);
  useEffect(() => () => stopDialogue(), []);
  const exhausted = plays >= block.plays;
  const play = async () => {
    if (playing) {
      stopDialogue();
      setPlaying(false);
      return;
    }
    setProblem("");
    setPlaying(true);
    const result = await playDialogue(block.transcript, rate, setLine);
    setPlaying(false);
    if (result === "done") setPlays((count) => count + 1);
    if (result === "none")
      setProblem("На устройстве нет греческого голоса. Включите его в настройках речи — или откройте текст.");
    if (result === "error") setProblem("Воспроизведение прервалось. Попробуйте ещё раз.");
  };
  const transcript = revealed || shown;
  return (
    <>
      <h3 className={`${css.blockTitle} ${css.greek}`} lang="el">
        {block.title}
      </h3>
      <p className={css.instruction}>
        Прослушайте {block.plays === 2 ? "дважды, как на экзамене" : `${block.plays} раз`}, затем ответьте. Текст
        откроется после ответа.
      </p>
      <div className={css.player}>
        <button
          type="button"
          className={css.play}
          onClick={() => void play()}
          disabled={exhausted && !playing && !transcript}
          aria-label={playing ? "Остановить" : "Слушать"}
        >
          {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
        </button>
        <span className={css.meta}>
          Прослушано {Math.min(plays, block.plays)} из {block.plays}
        </span>
        <Button
          variant="quiet"
          size="sm"
          aria-pressed={rate === "slow"}
          onClick={() => setRate(rate === "slow" ? "normal" : "slow")}
        >
          {rate === "slow" ? "Медленно" : "Обычная скорость"}
        </Button>
      </div>
      {problem ? <p className={css.pen}>{problem}</p> : null}
      {transcript ? (
        <ol className={css.transcript} lang="el">
          {block.transcript.map((entry, index) => (
            <li key={index} className={index === line ? css.speaking : undefined}>
              {entry.speaker ? <span className={css.speaker}>{entry.speaker}</span> : null}
              <Line blockId={block.id} index={index} text={entry.text} />
            </li>
          ))}
        </ol>
      ) : exhausted || problem ? (
        <div className={css.actions}>
          <Button variant="quiet" size="sm" onClick={() => setShown(true)}>
            Открыть текст
          </Button>
        </div>
      ) : null}
      {block.source ? <p className={css.meta}>Источник: {block.source}</p> : null}
    </>
  );
}

const statusLabel: Record<ItemResult["status"], string> = { correct: "верно", almost: "почти", wrong: "неверно" };

export function Exercise({
  block,
  progress,
  save,
}: {
  block: ExerciseBlock;
  progress: BlockProgress | undefined;
  save: (patch: BlockPatch) => Promise<unknown>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(progress?.answers ?? {});
  const [checked, setChecked] = useState(!!progress?.done);
  // Выполнено на другом устройстве: счёт пришёл синхронизацией, а введённые ответы остались там.
  const elsewhere = checked && !Object.keys(answers).length;
  const score = checked && !elsewhere ? scoreExercise(block, answers) : null;
  const total = score ?? (elsewhere ? progress?.score : undefined);
  const choose = (itemId: string, value: string) => {
    if (checked) return;
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
  };
  const check = async () => {
    const result = scoreExercise(block, answers);
    setChecked(true);
    await save({
      done: true,
      answers,
      score: { correct: result.correct, almost: result.almost, total: result.total },
    });
  };
  const retry = async () => {
    setChecked(false);
    setAnswers({});
    await save({ done: false, answers: {}, score: undefined });
  };
  const options = (itemOptions: string[] | undefined) => itemOptions ?? block.bank ?? [];
  const answered = block.items.every((item) => (answers[item.id] ?? "").trim());
  return (
    <>
      {block.title ? <h3 className={css.blockTitle}>{block.title}</h3> : null}
      <p className={css.instruction}>{block.instruction}</p>
      {block.bank && block.format === "gap" ? (
        <p className={`${css.prompt} ${css.soft}`} lang="el">
          Слова: {block.bank.join(" · ")}
        </p>
      ) : null}
      {block.items.map((item, index) => {
        const result = score?.results[item.id];
        const given = answers[item.id] ?? "";
        return (
          <div key={item.id} className={css.item}>
            {result && result.status !== "wrong" ? (
              <Tick
                className={result.status === "almost" ? `${css.itemMark} ${css.almost}` : css.itemMark}
                label={statusLabel[result.status]}
              />
            ) : null}
            <p className={css.prompt} lang="el">
              <span className={css.soft}>{index + 1}. </span>
              {item.prompt}
            </p>
            {block.format === "text" ? (
              <input
                className={css.answerInput}
                lang="el"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={`Ответ ${index + 1}`}
                value={given}
                readOnly={checked}
                onChange={(event) => choose(item.id, event.target.value)}
              />
            ) : (
              <div className={css.options} role="group" aria-label={`Варианты ${index + 1}`}>
                {options(item.options).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={css.option}
                    lang="el"
                    aria-pressed={given === option}
                    disabled={checked}
                    onClick={() => {
                      choose(item.id, option);
                      const text = spokenChoice(item.prompt, option);
                      if (text) void speakPhrase(text);
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            {result ? (
              result.status === "correct" ? null : (
                <p className={result.status === "almost" ? `${css.pen} ${css.almost}` : css.pen}>
                  {result.status === "almost" ? "Почти — проверьте ударение: " : "Верно: "}
                  <span lang="el">{result.expected}</span>
                  {item.explanation ? ` — ${item.explanation}` : ""}
                </p>
              )
            ) : null}
          </div>
        );
      })}
      <div className={css.actions}>
        {checked ? (
          <>
            <span
              className={total && total.correct + total.almost < total.total ? `${css.score} ${css.almost}` : css.score}
              role="status"
            >
              {total ? `${total.correct + total.almost} из ${total.total}` : "Выполнено"}
              {elsewhere ? " · на другом устройстве" : ""}
            </span>
            <Button variant="quiet" size="sm" onClick={() => void retry()}>
              Ещё раз
            </Button>
          </>
        ) : (
          <Button variant="soft" size="md" disabled={!answered} onClick={() => void check()}>
            Проверить
          </Button>
        )}
      </div>
    </>
  );
}

function Criteria({
  criteria,
  checks,
  toggle,
}: {
  criteria: string[];
  checks: number[];
  toggle: (index: number) => void;
}) {
  return (
    <>
      <p className={css.selfCheck}>Самопроверка — не оценка экзаменатора</p>
      <ul className={css.criteria}>
        {criteria.map((criterion, index) => (
          <li key={index}>
            <label>
              <input type="checkbox" checked={checks.includes(index)} onChange={() => toggle(index)} />
              <span>{criterion}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Writing({
  block,
  progress,
  save,
}: {
  block: WritingBlock;
  progress: BlockProgress | undefined;
  save: (patch: BlockPatch) => Promise<unknown>;
}) {
  const [text, setText] = useState(progress?.text ?? "");
  const [checks, setChecks] = useState<number[]>(progress?.checks ?? []);
  const [review, setReview] = useState(!!progress?.done);
  const count = wordCount(text);
  const toggle = (index: number) =>
    setChecks((prev) => (prev.includes(index) ? prev.filter((value) => value !== index) : [...prev, index]));
  return (
    <>
      <h3 className={css.blockTitle}>{block.register === "formal" ? "Официальный текст" : "Письмо"}</h3>
      <p className={css.print}>{block.prompt}</p>
      <p className={css.instruction}>
        {block.words.min}–{block.words.max} слов · сейчас {count}
      </p>
      <textarea
        className={css.writing}
        lang="el"
        aria-label="Ваш текст"
        autoComplete="off"
        autoCapitalize="sentences"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void save({ text })}
      />
      {review ? (
        <>
          <p className={css.instruction}>Образец</p>
          <Model blockId={block.id} text={block.model} />
          <Criteria criteria={block.criteria} checks={checks} toggle={toggle} />
          <div className={css.actions}>
            <Button variant="soft" size="md" onClick={() => void save({ done: true, text, checks })}>
              {progress?.done ? "Сохранить самопроверку" : "Готово"}
            </Button>
          </div>
        </>
      ) : (
        <div className={css.actions}>
          <Button
            variant="soft"
            size="md"
            disabled={count < block.words.min}
            onClick={() => {
              setReview(true);
              void save({ text });
            }}
          >
            Сравнить с образцом
          </Button>
        </div>
      )}
    </>
  );
}

const PART_LABEL: Record<SpeakingBlock["part"], string> = {
  interview: "Вопросы о себе",
  monologue: "Монолог",
  roleplay: "Ролевая игра",
};
/** Речь: таймер и запись для себя (остаётся только в памяти страницы), затем образец и самопроверка. */
export function Speaking({
  block,
  progress,
  save,
}: {
  block: SpeakingBlock;
  progress: BlockProgress | undefined;
  save: (patch: BlockPatch) => Promise<unknown>;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const [checks, setChecks] = useState<number[]>(progress?.checks ?? []);
  const [review, setReview] = useState(!!progress?.done);
  const [recording, setRecording] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stop();
    },
    [],
  );
  useEffect(() => () => void (recording && URL.revokeObjectURL(recording)), [recording]);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stop();
    setLeft(null);
    setReview(true);
  };
  const start = async () => {
    setLeft(block.seconds);
    timer.current = setInterval(() => setLeft((value) => (value === null ? null : value - 1)), 1000);
    // Запись необязательна: без микрофона остаётся таймер и самопроверка.
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
      if (!stream) return;
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream);
      media.ondataavailable = (event) => chunks.push(event.data);
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(URL.createObjectURL(new Blob(chunks, { type: media.mimeType })));
      };
      media.start();
      recorder.current = media;
    } catch {
      recorder.current = null;
    }
  };
  // Время вышло — запись останавливается, открываются образец и самопроверка.
  useEffect(() => {
    if (left === 0) stop();
  });
  const toggle = (index: number) =>
    setChecks((prev) => (prev.includes(index) ? prev.filter((value) => value !== index) : [...prev, index]));
  return (
    <>
      <h3 className={css.blockTitle}>Речь · {PART_LABEL[block.part]}</h3>
      <p className={css.print}>{block.prompt}</p>
      <p className={css.instruction}>Говорите вслух без подготовки, как на экзамене: до {block.seconds} с.</p>
      <div className={css.player}>
        {left === null ? (
          <Button variant="soft" size="md" onClick={() => void start()}>
            <Mic aria-hidden /> {review ? "Ещё раз" : "Начать"}
          </Button>
        ) : (
          <>
            <span className={css.timer} role="timer" aria-live="off">
              {left} с
            </span>
            <Button variant="quiet" size="sm" onClick={stop}>
              <Square aria-hidden /> Закончить
            </Button>
          </>
        )}
      </div>
      {recording ? <audio className="mt-3 w-full" controls src={recording} aria-label="Ваша запись" /> : null}
      {review ? (
        <>
          {block.model ? (
            <>
              <p className={css.instruction}>Образец ответа</p>
              <Model blockId={block.id} text={block.model} />
            </>
          ) : null}
          <Criteria criteria={block.criteria} checks={checks} toggle={toggle} />
          <div className={css.actions}>
            <Button variant="soft" size="md" onClick={() => void save({ done: true, checks })}>
              {progress?.done ? "Сохранить самопроверку" : "Готово"}
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}
