import type { SessionItem } from "../../../domain/types";
import { shortTitle } from "../../../shared/format";
import { Instruction } from "../notebook";
import { useAutoSpeak } from "./hooks";
import { PhraseReveal, Primary, WordReveal } from "./parts";

export const lessonLabel = (item: Pick<SessionItem, "lessonTitle">) =>
  item.lessonTitle ? `Хвост урока ${shortTitle(item.lessonTitle)}` : null;

export function Introduction({
  item,
  onReady,
  saving = false,
  autoSpeak = false,
}: {
  item: Pick<SessionItem, "card" | "lessonTitle">;
  onReady: () => void;
  saving?: boolean;
  autoSpeak?: boolean;
}) {
  const { card } = item;
  const label = lessonLabel(item);
  // Знакомство показывает материал, а не проверяет знание: отказ озвучки здесь не показывается — кнопка сама объясняет недоступность.
  useAutoSpeak(card, autoSpeak);
  return (
    <>
      <Instruction prompt={card.kind === "word" ? "Новое слово" : "Новая фраза"}>
        {label && (
          <>
            {" · "}
            <span data-testid="lesson-label">{label}</span>
          </>
        )}
      </Instruction>
      {card.kind === "word" && <WordReveal word={card.word} speak large />}
      {card.kind === "phrase" && <PhraseReveal phrase={card.phrase} speak />}
      <Primary disabled={saving} onClick={onReady}>
        {saving ? "Сохраняем…" : "Далее"}
      </Primary>
    </>
  );
}
