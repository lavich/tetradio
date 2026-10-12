import { useCallback, useEffect, useRef } from "react";
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
    else if (card.kind === "phrase") void playText(card.phrase.text, card.phrase.audioAssetId, profile);
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

/** На телефоне фокус поднял бы экранную клавиатуру поверх задания. */
export function focusWithKeyboard(element: HTMLElement | null) {
  if (element && typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches)
    element.focus({ preventScroll: true });
}

export const digitIndex = (key: string) => (/^[1-9]$/.test(key) ? Number(key) - 1 : -1);

const ARROWS: Record<string, [across: number, down: number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};
function moveFocus(group: HTMLElement, [across, down]: [number, number], columns: number) {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  if (!buttons.length) return;
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const step = across + down * columns;
  const next =
    current < 0
      ? step > 0
        ? 0
        : buttons.length - 1
      : down
        ? current + step
        : (current + step + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

/**
 * Клавиши группы кнопок: стрелки, а `onKey` — цифры и прочее; Enter и пробел кнопки нажимают сами.
 * Слушаем документ, потому что после «Далее» фокус уходит с исчезнувшей кнопки на страницу. Фокус при открытии —
 * на группе, а не на первой кнопке: удержанный Enter иначе сразу выбрал бы вариант.
 */
export function useTaskKeys({
  active,
  columns = 1,
  onKey,
}: {
  active: boolean;
  columns?: number;
  onKey: (event: KeyboardEvent) => boolean;
}) {
  const group = useRef<HTMLElement | null>(null);
  const latest = useRef(onKey);
  latest.current = onKey;
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      const { target } = event;
      if (event.altKey || event.ctrlKey || event.metaKey || !group.current) return;
      if (target !== document.body && !(target instanceof Node && group.current.contains(target))) return;
      const arrow = ARROWS[event.key];
      if (arrow) {
        event.preventDefault();
        moveFocus(group.current, arrow, columns);
      } else if (!event.repeat && latest.current(event)) event.preventDefault();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [active, columns]);
  return useCallback((element: HTMLElement | null) => {
    group.current = element;
    focusWithKeyboard(element);
  }, []);
}
