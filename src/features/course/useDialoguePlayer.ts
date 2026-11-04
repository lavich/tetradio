import { useEffect, useRef, useState } from "react";
import type { TranscriptLine } from "../../content/course";
import type { LanguageProfile } from "../../domain/language";
import { playDialogue, stopDialogue, type DialogueResult, type Rate } from "../../shared/dialogue";
import type { AssetSource } from "../../shared/store";

export type PlayerPhase = "idle" | "playing" | "paused";

interface Options {
  lines: TranscriptLine[];
  rate: Rate;
  source: AssetSource;
  profile: LanguageProfile;
  lenient?: boolean;
  onLine?: (index: number) => void;
  onStart?: () => void;
  onResult: (result: Exclude<DialogueResult, "stopped">) => void;
}

export function useDialoguePlayer({ lines, rate, source, profile, lenient, onLine, onStart, onResult }: Options) {
  const [phase, setPhase] = useState<PlayerPhase>("idle");
  const run = useRef(0);
  const at = useRef(0);
  useEffect(
    () => () => {
      run.current++;
      stopDialogue();
    },
    [],
  );
  const halt = () => {
    run.current++;
    stopDialogue();
  };
  const start = async () => {
    const mine = ++run.current;
    const from = at.current < lines.length ? at.current : 0;
    onStart?.();
    setPhase("playing");
    const result = await playDialogue(
      lines,
      rate,
      (index) => {
        if (mine !== run.current) return;
        if (index >= 0) at.current = index;
        onLine?.(index);
      },
      source,
      profile,
      lenient,
      from,
    );
    if (mine !== run.current) return;
    if (result === "stopped") {
      setPhase("paused");
      return;
    }
    at.current = 0;
    setPhase("idle");
    onLine?.(-1);
    onResult(result);
  };
  const toggle = () => {
    if (phase !== "playing") return void start();
    halt();
    setPhase("paused");
  };
  const stop = () => {
    halt();
    at.current = 0;
    setPhase("idle");
    onLine?.(-1);
  };
  return { phase, toggle, stop };
}
