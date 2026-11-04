import { Pause, Play, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PlayerPhase } from "../useDialoguePlayer";
import css from "./blocks.module.css";

const LABELS = { idle: "Слушать", playing: "Пауза", paused: "Продолжить" } as const;

export function PlayerButtons({
  phase,
  onToggle,
  onStop,
  disabled = false,
}: {
  phase: PlayerPhase;
  onToggle: () => void;
  onStop: () => void;
  disabled?: boolean;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  const stop = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (phase === "idle" && document.activeElement === stop.current) toggle.current?.focus();
  }, [phase]);
  return (
    <>
      <button
        ref={toggle}
        type="button"
        className={css.play}
        onClick={onToggle}
        disabled={disabled}
        aria-label={LABELS[phase]}
      >
        {phase === "playing" ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
      </button>
      <button
        ref={stop}
        type="button"
        className={css.play}
        onClick={onStop}
        disabled={phase === "idle"}
        aria-label="Остановить"
      >
        <Square size={18} aria-hidden />
      </button>
    </>
  );
}
