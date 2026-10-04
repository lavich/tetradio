import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ListeningBlock } from "../../../content/course";
import { playDialogue, stopDialogue, type Rate } from "../../../shared/dialogue";
import { Marked, useFieldMarks } from "../WordTaps";
import base from "../course.module.css";
import css from "./blocks.module.css";

function Line({ blockId, index, text }: { blockId: string; index: number; text: string }) {
  return <Marked text={text} marks={useFieldMarks(blockId, `transcript.${index}`)} />;
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
      <h3 className={`${base.blockTitle} ${base.greek}`} lang="el">
        {block.title}
      </h3>
      <p className={base.instruction}>
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
        <span className={base.meta}>
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
      {problem ? <p className={base.pen}>{problem}</p> : null}
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
        <div className={base.actions}>
          <Button variant="quiet" size="sm" onClick={() => setShown(true)}>
            Открыть текст
          </Button>
        </div>
      ) : null}
      {block.source ? <p className={base.meta}>Источник: {block.source}</p> : null}
    </>
  );
}
