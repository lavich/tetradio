import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Volume2 } from "lucide-react";
import { languageOfText } from "../../../domain/language";
import type { SessionCard } from "../../../domain/types";
import { playText, playWord, useAudioKind, useTextAudioKind } from "../../../shared/audio";
import s from "./replay.module.css";

interface Replay {
  text: string;
  kind: ReturnType<typeof useAudioKind>;
  failed: boolean;
  play: () => void;
}
/**
 * Звуковая часть аудирования и понимания на слух: что звучит, доступно ли это и не отказало ли воспроизведение.
 * Пропуск сюда не приходит: `listening` и `comprehension` создаются только для слов и фраз (`domain/learning.ts`).
 */
export function useReplay(card: SessionCard, itemId: string, autoSpeak: boolean | undefined): Replay {
  const word = card.kind === "word" ? card.word : null;
  const phrase = card.kind === "phrase" ? card.phrase : null;
  const audioAssetId = word ? word.audioAssetId : phrase?.audioAssetId;
  const text = word ? word.greek : (phrase?.text ?? "");
  const wordKind = useAudioKind(word ?? undefined);
  const textKind = useTextAudioKind(audioAssetId, languageOfText(text));
  const played = useRef(false);
  const [failed, setFailed] = useState(false);
  const play = () =>
    (word ? playWord(word) : playText(text, audioAssetId)).then((result) =>
      setFailed(result === "error" || result === "none"),
    );
  useEffect(() => {
    if (autoSpeak && !played.current) {
      played.current = true;
      void play();
    }
  }, [itemId, autoSpeak]);
  if (!word && !phrase) throw new Error("Аудиоупражнение получило карточку с пропуском");
  return { text, kind: word ? wordKind : textKind, failed, play };
}
/** Большая кнопка повтора над вариантами и сообщение об отказе воспроизведения — одинаковые в обоих аудиоупражнениях. */
export function ReplayHead({ replay, onSkip }: { replay: Replay; onSkip?: () => void }) {
  return (
    <>
      <div className={s.play}>
        <Button
          size="icon-xl"
          className="size-14 rounded-full [&_svg:not([class*='size-'])]:size-6.5"
          disabled={replay.kind === "none"}
          aria-label="Повторить аудио"
          onClick={replay.play}
        >
          <Volume2 aria-hidden />
        </Button>
        <span className={s.playNote}>{replay.kind === "none" ? "Озвучка недоступна" : "Послушать ещё раз"}</span>
      </div>
      {replay.failed && (
        <div data-testid="audio-failed" role="alert" className={s.audioFailed}>
          <p>Аудио не воспроизвелось. Это не влияет на прогресс: попробуйте ещё раз или продолжите без аудирования.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={replay.play}>
              Повторить
            </Button>
            {onSkip && (
              <Button size="sm" variant="outline" onClick={onSkip}>
                Продолжить без аудио
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
