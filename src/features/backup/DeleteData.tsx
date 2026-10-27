import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formAvailable } from "../../platform/feedback";
import type { EraseFailure, EraseReason } from "../../storage/erase";
import { currentProfile } from "../../storage/profile";
import ui from "../../shared/ui.module.css";
import css from "../progress/settings.module.css";
import { backupName, exportFull, transferFile, TRANSFER_TEXT } from "./backup";

const FAILURES: Record<EraseReason, string> = {
  messages: "Не удалось удалить переписку. Попробуйте позже.",
  waitlist: "Не удалось удалить заявки на курсы. Проверьте сеть и повторите.",
  stale: "Перезапустите приложение и повторите.",
  unavailable: "Облако Telegram недоступно — перезапустите приложение и повторите.",
  cloud: "Не удалось удалить данные из облака Telegram. Проверьте сеть и попробуйте ещё раз.",
  busy: "Синхронизацией занята другая вкладка — закройте её и повторите.",
};

// Код удаления тянет синхронизацию целиком: грузится по нажатию, а не с экраном настроек.
const eraseNow = async (withMessages: boolean) => {
  const [{ eraseMyData }, { eraseDeps }] = await Promise.all([
    import("../../storage/erase"),
    import("../../app/erase-deps"),
  ]);
  return eraseMyData(withMessages, eraseDeps());
};
const isFailure = (error: unknown): error is EraseFailure =>
  error instanceof Error && "reason" in error && "messagesGone" in error;

export function DeleteData({ erase = eraseNow }: { erase?: (withMessages: boolean) => Promise<void> }) {
  const telegram = currentProfile().kind === "telegram";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "erasing">("idle");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const busy = phase !== "idle";
  const close = () => {
    setOpen(false);
    setMessages(false);
    setNote("");
    setProblem("");
  };
  const offerMessages = open && formAvailable();

  const save = async () => {
    setPhase("saving");
    setNote("");
    try {
      setNote(TRANSFER_TEXT[await transferFile(await exportFull(), backupName())]);
    } catch {
      setNote("Не удалось сохранить копию.");
    } finally {
      setPhase("idle");
    }
  };
  const remove = async () => {
    setPhase("erasing");
    setProblem("");
    try {
      await erase(messages && offerMessages);
    } catch (error) {
      setProblem(
        isFailure(error)
          ? `${FAILURES[error.reason]}${error.messagesGone ? " Переписка уже удалена." : ""}`
          : FAILURES.cloud,
      );
      setPhase("idle");
    }
  };

  return (
    <section aria-labelledby="erase" className={css.section}>
      <h2 id="erase" className={css.heading}>
        Удаление данных
      </h2>
      <p className={css.note}>Удаляет прогресс, слова и настройки на этом устройстве и в облаке Telegram.</p>
      <Button variant="destructive" size="md" className="mt-2 w-auto self-start" onClick={() => setOpen(true)}>
        Удалить мои данные…
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !busy && (next ? setOpen(true) : close())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить все данные?</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              <ul className="list-disc pl-5 text-left">
                <li>Прогресс, слова, ответы и настройки на этом устройстве.</li>
                {telegram && <li>Прогресс в облаке Telegram.</li>}
                {offerMessages && <li>Заявки на курсы в работе.</li>}
                {messages && offerMessages && <li>Ваша переписка с автором в группе поддержки.</li>}
                {telegram && (
                  <li>На других устройствах удаление нужно повторить — иначе они снова сохранят прогресс в облако.</li>
                )}
                <li>Отчёты об ошибках после удаления снова включатся.</li>
                {telegram && <li>Сообщения в вашем чате с ботом удаляете вы сами.</li>}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {offerMessages && (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={messages}
                disabled={busy}
                onChange={(event) => setMessages(event.target.checked)}
              />
              И переписку с автором
            </label>
          )}
          {note && (
            <p className={css.note} role="status">
              {note}
            </p>
          )}
          {phase === "erasing" && (
            <p className={css.note} role="status">
              Удаляем…
            </p>
          )}
          {problem && (
            <p className={ui.error} role="alert">
              {problem}
            </p>
          )}
          <AlertDialogFooter>
            <Button variant="soft" size="md" disabled={busy} onClick={() => void save()}>
              Сначала сохранить копию
            </Button>
            <Button variant="soft" size="md" disabled={busy} onClick={close}>
              Отмена
            </Button>
            <Button variant="destructive" size="md" disabled={busy} onClick={() => void remove()}>
              Удалить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
