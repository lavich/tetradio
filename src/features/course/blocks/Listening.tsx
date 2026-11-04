import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ListeningBlock } from "../../../content/course";
import type { Rate } from "../../../shared/dialogue";
import { useProfile } from "../../../shared/language";
import { useAssetSource } from "../../../shared/store";
import { useDialoguePlayer } from "../useDialoguePlayer";
import { Marked, useFieldMarks } from "../WordTaps";
import { PlayerButtons } from "./PlayerButtons";
import ui from "../../../shared/ui.module.css";
import base from "../course.module.css";
import css from "./blocks.module.css";

function Line({ blockId, index, text }: { blockId: string; index: number; text: string }) {
  return <Marked text={text} marks={useFieldMarks(blockId, `transcript.${index}`)} />;
}

export function Listening({ block, revealed }: { block: ListeningBlock; revealed: boolean }) {
  const [plays, setPlays] = useState(0);
  const [line, setLine] = useState(-1);
  const [rate, setRate] = useState<Rate>("normal");
  const [problem, setProblem] = useState<{ text: string; failure: boolean } | null>(null);
  const [shown, setShown] = useState(false);
  const source = useAssetSource();
  const profile = useProfile();
  const { phase, toggle, stop } = useDialoguePlayer({
    lines: block.transcript,
    rate,
    source,
    profile,
    onLine: setLine,
    onStart: () => setProblem(null),
    onResult: (result) => {
      if (result === "done") setPlays((count) => count + 1);
      if (result === "none")
        setProblem({
          text: `На устройстве нет ${profile.voiceName}. Включите его в настройках речи — или откройте текст.`,
          failure: false,
        });
      if (result === "error") setProblem({ text: "Воспроизведение прервалось. Попробуйте ещё раз.", failure: true });
    },
  });
  const exhausted = plays >= block.plays;
  const transcript = revealed || shown;
  return (
    <>
      <h3 className={`${base.blockTitle} ${base.greek}`} lang={profile.code}>
        {block.title}
      </h3>
      <p className={base.instruction}>
        Прослушайте {block.plays === 2 ? "дважды, как на экзамене" : `${block.plays} раз`}, затем ответьте. Текст
        откроется после ответа.
      </p>
      <div className={css.player}>
        <PlayerButtons
          phase={phase}
          onToggle={toggle}
          onStop={stop}
          disabled={exhausted && phase === "idle" && !transcript}
        />
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
      {problem?.failure ? (
        <p className={ui.error} role="alert">
          {problem.text}
        </p>
      ) : problem ? (
        <p className={ui.note} role="status">
          {problem.text}
        </p>
      ) : null}
      {transcript ? (
        <ol className={css.transcript} lang={profile.code}>
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
