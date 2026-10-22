import { toast } from "sonner";
import type { Course, Word } from "../domain/types";
import { launchContext } from "./launch";
import { telegramBridge } from "./platform";
import type { TelegramWebApp } from "./telegram-types";
import { holdUpdate } from "../app/auto-update";

/** Ссылка на слово всегда ведёт через бота: получатели в основном в Telegram. */
export const wordLink = (wordId: string, bot: string) => `https://t.me/${bot}?startapp=w_${wordId}`;

export const courseLink = (courseId: string, bot: string) => `https://t.me/${bot}?startapp=c_${courseId}`;

/**
 * В Telegram — выбор чата со ссылкой; в браузере — системное меню, а без него или при его сбое — копирование ссылки.
 * Отмена пользователем ничего не копирует.
 */
async function send(url: string, text: string, app: TelegramWebApp | null): Promise<void> {
  if (app?.openTelegramLink) {
    app.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
    return;
  }
  if (typeof navigator.share === "function") {
    try {
      await holdUpdate(navigator.share({ url, text }));
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

/** «Поделиться» словом в версии курса. */
export const shareWord = (
  word: Pick<Word, "id" | "greek" | "russian">,
  bot: string = launchContext().bot,
  app: TelegramWebApp | null = telegramBridge(),
) => send(wordLink(word.id, bot), `${word.greek} — ${word.russian}`, app);

/** «Поделиться» курсом: получатель увидит его полку. */
export const shareCourse = (
  course: Pick<Course, "id" | "title">,
  bot: string = launchContext().bot,
  app: TelegramWebApp | null = telegramBridge(),
) => send(courseLink(course.id, bot), course.title, app);
