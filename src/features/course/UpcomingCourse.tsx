import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BellRing, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formAvailable } from "../../platform/feedback";
import { askWriteAccess, waitlist, type SendResult } from "../../platform/feedback-send";
import { launchContext } from "../../platform/launch";
import { telegramBridge } from "../../platform/platform";
import type { UpcomingEntry } from "../../storage/courses";
import { Tick } from "../../shared/Tick";
import ui from "../../shared/ui.module.css";
import css from "./shelf.module.css";

const LATER = "Напишем в чат с ботом, когда откроется первый модуль.";
const PROBLEMS = {
  check: "Не удалось проверить заявку.",
  join: "Не удалось отправить заявку. Попробуйте позже.",
  leave: "Не удалось отменить заявку. Попробуйте позже.",
  stale: "Перезапустите приложение и повторите.",
  rate: "Подождите несколько секунд и повторите.",
  denied: "Без разрешения писать бот не сможет сообщить о выходе курса.",
};

/** Ответ бота живёт до конца запуска: страница открывается снова без запроса. */
const known = new Map<string, boolean>();
const inflight = new Map<string, Promise<unknown>>();
/** Только для тестов. */
export const forgetWaitlistStatus = () => {
  known.clear();
  inflight.clear();
};

type Step = "status" | "join" | "leave";

export function UpcomingCourse({
  course,
  previousLevel,
  focused,
  onFocused,
}: {
  course: UpcomingEntry;
  previousLevel?: string;
  focused?: boolean;
  onFocused?: () => void;
}) {
  const heading = useId();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focused) return;
    title.current?.focus();
    onFocused?.();
  }, [focused, onFocused]);
  const about =
    course.goal ??
    `${previousLevel ? `Следующая ступень после ${previousLevel}. ` : ""}Курс ещё пишется, уроков пока нет.`;
  return (
    <section className={css.course} aria-labelledby={heading} data-testid="upcoming-course">
      <div className={css.head}>
        <h2 id={heading} ref={title} tabIndex={-1} className={css.title}>
          {course.level ? `${course.title} · ${course.level}` : course.title}
        </h2>
      </div>
      <div className="mt-6 grid grid-cols-[7.5rem_1fr] items-start gap-4">
        <div className={`${css.cover} ${css.draft}`} aria-hidden="true">
          <span className={css.coverNumber}>{course.level?.split(" → ").at(-1) ?? ""}</span>
          <span className={css.coverLabel}>Готовится</span>
        </div>
        <div>
          <p className="mt-0 mb-3 font-serif text-base leading-6">{about}</p>
          <p className="m-0 text-sm text-muted-foreground">
            Оставьте заявку — напишем в чат с ботом, когда откроется первый модуль.
          </p>
        </div>
      </div>
      <Waitlist courseId={course.id} />
    </section>
  );
}

function Waitlist({ courseId }: { courseId: string }) {
  const available = formAvailable();
  const [joined, setJoined] = useState<boolean | undefined>(known.get(courseId));
  const [busy, setBusy] = useState<Step | null>(null);
  const [problem, setProblem] = useState<{ text: string; retry: Step } | null>(null);
  const [said, setSaid] = useState("");
  const pending = useRef(false);
  const joinButton = useRef<HTMLButtonElement>(null);
  const leaveButton = useRef<HTMLButtonElement>(null);
  // Нажатая кнопка исчезает: фокус переходит на ту, что её заменила, а не на body.
  const focusAfter = useRef(false);
  // Запрос живёт дольше страницы: вернувшись на неё, учащийся видит его итог, а не прежний статус.
  const run = useCallback(
    async (step: Step) => {
      if (pending.current) return;
      pending.current = true;
      focusAfter.current = step !== "status";
      setBusy(step);
      try {
        const request = ask(step, courseId);
        if (step !== "status") inflight.set(courseId, request);
        const answer = await request;
        if (answer.joined !== undefined) {
          setJoined(answer.joined);
          setProblem(null);
          setSaid(answer.joined ? "Вы в списке" : step === "leave" ? "Заявка отменена" : "");
        } else setProblem({ text: answer.problem, retry: step });
      } finally {
        if (inflight.get(courseId)) inflight.delete(courseId);
        pending.current = false;
        setBusy(null);
      }
    },
    [courseId],
  );
  useEffect(() => {
    if (!available) return;
    const running = inflight.get(courseId);
    if (running) void running.then(() => setJoined(known.get(courseId)));
    else if (!known.has(courseId)) void run("status");
  }, [available, courseId, run]);
  useEffect(() => {
    if (!focusAfter.current || busy) return;
    focusAfter.current = false;
    (joined ? leaveButton : joinButton).current?.focus();
  }, [joined, busy]);
  if (!available)
    return launchContext().kind === "telegram" ? null : (
      <p className={`${ui.note} mt-6`}>Заявку можно оставить в приложении в Telegram.</p>
    );
  const blocked = !!busy || joined === undefined;
  return (
    <div className="mt-6">
      {joined ? (
        <>
          <div className="flex items-start gap-3 rounded-[14px] bg-soft px-4 py-3" data-testid="waitlist-joined">
            <Tick className="mt-0.5 h-6 w-[26px] shrink-0 text-[var(--ok)]" label="записано" />
            <div>
              <p className="m-0 font-semibold">Вы в списке</p>
              <p className="m-0 text-sm text-muted-foreground">{LATER}</p>
            </div>
          </div>
          <div className="mt-2 flex justify-center">
            <Button
              ref={leaveButton}
              size="md"
              variant="quiet"
              className="w-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={() => !blocked && void run("leave")}
              aria-disabled={blocked || undefined}
            >
              Отменить заявку
            </Button>
          </div>
        </>
      ) : (
        <Button
          ref={joinButton}
          size="xl"
          variant="soft"
          onClick={() => !blocked && void run("join")}
          aria-disabled={blocked || undefined}
          aria-busy={busy === "status" || undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <BellRing data-icon="inline-start" />
          Сообщить, когда выйдет
        </Button>
      )}
      <p className="sr-only" role="status">
        {busy === "join" ? "Отправляем заявку" : busy === "leave" ? "Отменяем заявку" : said}
      </p>
      {problem ? (
        <div className="mt-2">
          <p className={ui.error} role="alert" data-testid="waitlist-problem">
            {problem.text}
          </p>
          <Button
            size="md"
            variant="quiet"
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => !busy && void run(problem.retry)}
            aria-disabled={!!busy || undefined}
          >
            <RefreshCw data-icon="inline-start" />
            Повторить
          </Button>
        </div>
      ) : null}
    </div>
  );
}

async function ask(
  step: Step,
  courseId: string,
): Promise<{ joined: boolean } | { joined?: undefined; problem: string }> {
  if (step === "join") {
    const app = telegramBridge();
    // Каждое нажатие — явная просьба: Telegram спрашивает снова, даже если в этом запуске уже был отказ.
    if (app && !(await askWriteAccess(app, undefined, true))) return { problem: PROBLEMS.denied };
  }
  const { result, joined } = await waitlist(step, courseId);
  if (result === "ok" && joined !== undefined) {
    known.set(courseId, joined);
    return { joined };
  }
  return { problem: problemOf(result, step) };
}

function problemOf(result: SendResult, step: Step) {
  if (result === "stale") return PROBLEMS.stale;
  if (result === "rate") return PROBLEMS.rate;
  return step === "status" ? PROBLEMS.check : PROBLEMS[step];
}
