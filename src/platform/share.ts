import { toast } from "sonner";
import type { Word } from "../domain/types";
import { launchContext } from "./launch";
import { telegramBridge } from "./platform";
import type { TelegramWebApp } from "./telegram-types";

/** Ссылка на слово всегда ведёт через бота: получатели в основном в Telegram. */
export const wordLink = (wordId: string, bot: string) => `https://t.me/${bot}?startapp=w_${wordId}`;

/**
 * «Поделиться» словом в версии курса. В Telegram — выбор чата со ссылкой; в браузере — системное меню,
 * а без него или при его сбое — копирование ссылки. Отмена пользователем ничего не копирует.
 */
export async function shareWord(
  word: Pick<Word, "id" | "greek" | "russian">,
  bot: string = launchContext().bot,
  app: TelegramWebApp | null = telegramBridge(),
): Promise<void> {
  const url = wordLink(word.id, bot);
  const text = `${word.greek} — ${word.russian}`;
  if (app?.openTelegramLink) {
    app.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
    return;
  }
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ url, text });
      return;
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Ссылка скопирована");
  } catch {
    toast.error("Не удалось скопировать ссылку");
  }
}
