import { useEffect, useRef } from "react";
import type { SessionCard } from "../../../domain/types";
import { playText, playWord } from "../../../shared/audio";
import { useProfile } from "../../../shared/language";

/** Раскрытый ответ подводим к верху области прокрутки: иначе он остаётся под облачком. */
export function useRevealed(active: boolean, block: ScrollLogicalPosition = "start") {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const smooth = typeof matchMedia === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block, behavior: smooth ? "smooth" : "auto" }));
  }, [active]);
  return ref;
}

/**
 * Один автозапуск озвучки при открытии карточки. Карточки перемонтируются по `key`, поэтому
 * ссылка-флаг защищает от повторного запуска при перерисовке той же карточки.
 */
export function useAutoSpeak(card: SessionCard, enabled: boolean) {
  const played = useRef(false);
  const profile = useProfile();
  useEffect(() => {
    if (!enabled || played.current) return;
    played.current = true;
    if (card.kind === "word") void playWord(card.word, profile);
    else void playText(card.phrase.text, card.phrase.audioAssetId, profile);
  }, [card, enabled]);
}

/**
 * Один автозапуск озвучки раскрытия: до ответа в письме звук запрещён, поэтому запуск привязан не к открытию
 * карточки, а к появлению результата. `itemId` и `card` намеренно не в зависимостях — ответ сбрасывается
 * эффектом по `item.id`, и в первом кадре с новой карточкой `answered` ещё истинно: зависимость от карточки
 * озвучила бы новое слово до того, как его написали.
 */
export function useRevealSpeech(card: SessionCard, itemId: string, answered: boolean, enabled: boolean) {
  const spoken = useRef<string | null>(null);
  const profile = useProfile();
  useEffect(() => {
    if (!answered || !enabled || spoken.current === itemId) return;
    spoken.current = itemId;
    if (card.kind === "word") void playWord(card.word, profile);
    else if (card.kind === "phrase") void playText(card.phrase.text, card.phrase.audioAssetId, profile);
  }, [answered, enabled]);
}
