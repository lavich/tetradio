import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { openFeedback } from "../../platform/feedback";
import { askWriteAccess, sendFeedback, type SendResult } from "../../platform/feedback-send";
import { telegramBridge } from "../../platform/platform";
import ui from "../../shared/ui.module.css";

export const MAX_LENGTH = 3000;
const DRAFT_KEY = "tetradio:feedback-draft";

const ERRORS: Record<Exclude<SendResult, "ok">, string> = {
  failed: "Не удалось отправить. Проверьте сеть и попробуйте ещё раз.",
  stale: "Закройте приложение и откройте снова — текст сохранится.",
  rate: "Подождите несколько секунд и отправьте снова.",
};

const readDraft = () => {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
};
const writeDraft = (text: string) => {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Без хранилища черновик просто не переживёт перезапуск.
  }
};

type State =
  { kind: "editing" } | { kind: "sending" } | { kind: "sent"; canReply: boolean } | { kind: "error"; text: string };

export default function FeedbackForm({ reportId }: { reportId: string | null }) {
  const [text, setText] = useState(readDraft);
  const [state, setState] = useState<State>({ kind: "editing" });
  const field = useRef<HTMLTextAreaElement>(null);
  const label = useId();
  const hint = useId();
  const over = text.length - MAX_LENGTH;
  const sending = state.kind === "sending";

  useEffect(() => {
    if (state.kind === "editing" || state.kind === "error") field.current?.focus();
  }, [state.kind]);

  const submit = async () => {
    const app = telegramBridge();
    if (!app || sending) return;
    setState({ kind: "sending" });
    const canReply = await askWriteAccess(app);
    const result = await sendFeedback({ text: text.trim(), reportId, canReply }, { app });
    if (result === "ok") {
      writeDraft("");
      setText("");
      setState({ kind: "sent", canReply });
    } else setState({ kind: "error", text: ERRORS[result] });
  };

  if (state.kind === "sent")
    return (
      <div className="mt-3" data-testid="feedback-sent">
        <p role="status" style={{ color: "var(--ok)" }}>
          {state.canReply
            ? "Отправлено. Ответ придёт в чат с ботом."
            : "Отправлено. Автор не сможет ответить, пока боту нельзя писать вам."}
        </p>
        <Button
          size="md"
          variant="soft"
          className="mt-2 w-auto self-start"
          onClick={() => setState({ kind: "editing" })}
        >
          Написать ещё
        </Button>
      </div>
    );

  return (
    <form
      className="mt-3 flex flex-col gap-2"
      data-testid="feedback-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label id={label} className="sr-only">
        Сообщение автору
      </label>
      <Textarea
        ref={field}
        aria-labelledby={label}
        placeholder="Вопрос, ошибка в уроке или идея"
        value={text}
        disabled={sending}
        aria-invalid={over > 0}
        aria-describedby={over > 0 ? hint : undefined}
        onChange={(event) => {
          setText(event.target.value);
          writeDraft(event.target.value);
          if (state.kind === "error") setState({ kind: "editing" });
        }}
      />
      {over > 0 && (
        <p id={hint} className={ui.note}>
          Длиннее на {over} — предел {MAX_LENGTH} символов.
        </p>
      )}
      <p className={ui.note}>Вместе с сообщением уйдут версия приложения и платформа.</p>
      {state.kind === "error" && (
        <p className={ui.small} role="alert" style={{ color: "var(--pen)" }}>
          {state.text}
        </p>
      )}
      <Button type="submit" size="md" className="w-auto self-start" disabled={sending || !text.trim() || over > 0}>
        {sending ? "Отправка…" : "Отправить"}
      </Button>
      <button
        type="button"
        className={`${ui.small} min-h-11 self-start text-primary underline`}
        onClick={() => openFeedback(reportId)}
      >
        Приложить скриншот — в чате с ботом
      </button>
    </form>
  );
}
