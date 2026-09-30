import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { useAction } from "../../shared/action";
import { stopAudio } from "../../shared/audio";
import { useActiveSession, useSettings } from "../../shared/store";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { hapticsEnabled } from "../../platform/haptics";
import { useBackHandler, useHaptics, usePlatform } from "../../platform/platform";
import { db } from "../../storage/db";
import {
  ConflictError,
  endSession,
  recordAnswer,
  markIntroduced,
  prepareObjectiveSession,
  skipItem,
} from "../../storage/ops";
import { Assembly, Comprehension, Introduction, Listening, Recognition, Spelling, type Answer } from "./exercises";
import ui from "../../shared/ui.module.css";
import s from "./session.module.css";

export function SessionScreen() {
  const navigate = useNavigate();
  const { settings, ready: settingsReady } = useSettings();
  const other = useActiveSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Сессию держим по id: последний ответ переводит её в done, но экран должен дорисовать обратную связь.
  const session = useLiveQuery(
    () =>
      sessionId
        ? db.sessions.get(sessionId)
        : db.sessions
            .orderBy("id")
            .reverse()
            .filter((entry) => entry.status === "active")
            .first(),
    [sessionId],
  );
  const [cursor, setCursor] = useState<number | null>(null);
  const active = useRef({ ms: 0, since: Date.now() });
  useEffect(() => {
    if (!session || sessionId) return;
    setSessionId(session.id);
    setCursor(session.items.findIndex((entry) => !entry.eventId && !entry.skipped)); // продолжаем с первого неотвеченного
    active.current = { ms: session.activeTimeMs, since: Date.now() }; // время прошлых заходов не теряется
  }, [session?.id]);
  // Одна жалоба на экран: её ставят и знакомство, и сохранение ответа, и пропуск. `busy` здесь — идущее знакомство.
  const {
    busy: introducing,
    problem,
    setProblem,
    run,
  } = useAction("Не удалось сохранить знакомство. Попробуйте ещё раз.");
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    if (!session || session.objectiveVersion === 1) return;
    setPreparing(true);
    prepareObjectiveSession(session.id)
      .catch(() => setProblem("Не удалось подготовить занятие. Обновите страницу."))
      .finally(() => setPreparing(false));
  }, [session?.id, session?.objectiveVersion]);
  const shown = useRef(Date.now());
  const previous = useRef<string | undefined>(undefined);
  const position = cursor ?? session?.items.findIndex((entry) => !entry.eventId && !entry.skipped) ?? 0;
  const haptic = useHaptics();
  const nativeBack = usePlatform().capabilities.back;
  // Нативный «Назад» Telegram выполняет тот же выход из занятия, что и крестик: принятые ответы уже сохранены.
  const leaveRef = useRef<() => void>(() => navigate("/"));
  const [backHandler] = useState(() => () => leaveRef.current());
  useBackHandler(backHandler);
  const item = session && position >= 0 ? session.items[position] : undefined;
  // Общий проход знакомств всех новых видов завершается до проверок; пройденное знакомство хранится по ключу карточки.
  const introduction = session?.items.find(
    (entry) => entry.isNew && !entry.eventId && !entry.retryOf && !session.introducedKeys?.includes(entry.unitKey),
  );

  useEffect(() => {
    shown.current = Date.now();
    if (previous.current && !document.hidden) active.current.ms += Date.now() - active.current.since;
    previous.current = item?.id;
    active.current.since = Date.now();
    stopAudio();
  }, [item?.id, introduction?.unitKey]);
  useEffect(() => {
    // Время скрытой вкладки не считается активным временем занятия.
    const change = () => {
      if (document.hidden) {
        active.current.ms += Date.now() - active.current.since;
        stopAudio();
      } else active.current.since = Date.now();
    };
    document.addEventListener("visibilitychange", change);
    return () => {
      document.removeEventListener("visibilitychange", change);
      stopAudio();
    };
  }, []);
  useEffect(() => {
    if (session && session.items.length && position < 0)
      void navigate(`/session/result/${session.id}`, { replace: true });
  }, [session?.id, position]);

  if (session === undefined || preparing)
    return (
      <main className={s.session}>
        <div className="flex flex-col gap-3 py-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </main>
    );
  if (!session || !item) {
    return (
      <main className={s.session}>
        <p className={ui.muted}>Активного занятия нет.</p>
        <Button size="xl" onClick={() => navigate(other ? "/session" : "/")}>
          На главную
        </Button>
      </main>
    );
  }

  const introductions = session.items.filter((entry) => entry.isNew && !entry.eventId && !entry.retryOf);
  const step = introduction ? introductions.findIndex((entry) => entry.id === introduction.id) : position;
  const total = introduction ? introductions.length : session.items.length;
  const activeMs = () => active.current.ms + (document.hidden ? 0 : Date.now() - active.current.since);
  const answer = async ({ correct, text, status }: Answer): Promise<boolean> => {
    setProblem("");
    try {
      const { created } = await recordAnswer({
        session,
        item,
        correct,
        answer: text,
        status,
        responseTimeMs: Date.now() - shown.current,
        activeTimeMs: activeMs(),
        timezone: settings.timezone,
      });
      // Отклик — один раз после успешного локального сохранения нового ответа; повтор, ошибка записи и пропуск его не дают.
      if (created && hapticsEnabled()) haptic(status === "almost" ? "warning" : correct ? "success" : "error");
      return true;
    } catch (error) {
      setProblem(
        error instanceof ConflictError
          ? error.message
          : "Не удалось сохранить ответ. Проверьте место на устройстве и попробуйте ещё раз.",
      );
      return false;
    }
  };
  const introduce = () => {
    if (!introduction || introducing) return;
    return run(
      async () => {
        await markIntroduced(session.id, introduction.unitKey, activeMs());
        shown.current = Date.now();
      },
      () => "Не удалось сохранить знакомство. Попробуйте ещё раз.",
    );
  };
  const next = () => {
    const following = position + 1;
    if (following >= session.items.length) return navigate(`/session/result/${session.id}`, { replace: true });
    setCursor(following);
  };
  const leave = async () => {
    await endSession({ ...session, activeTimeMs: activeMs() });
    void navigate("/");
  };
  leaveRef.current = leave;
  const skip = async () => {
    setProblem("");
    try {
      await skipItem(session.id, item.id, activeMs());
      void next();
    } catch {
      setProblem("Не удалось пропустить упражнение. Попробуйте ещё раз.");
    }
  };
  // key по упражнению: иначе следующая карточка успевает показаться с ответом предыдущей.
  const view =
    session.objectiveVersion !== 1 ? null : introduction ? (
      <Introduction
        key={introduction.id}
        item={introduction}
        onReady={introduce}
        saving={introducing}
        autoSpeak={settingsReady && settings.autoSpeak}
      />
    ) : item.type === "recognition" ? (
      <Recognition
        key={item.id}
        item={item}
        onAnswer={answer}
        onNext={next}
        autoSpeak={settingsReady && settings.autoSpeak}
      />
    ) : item.type === "listening" ? (
      <Listening
        key={item.id}
        item={item}
        onAnswer={answer}
        onNext={next}
        onSkip={skip}
        autoSpeak={settingsReady && settings.autoSpeak}
      />
    ) : item.type === "comprehension" ? (
      <Comprehension
        key={item.id}
        item={item}
        onAnswer={answer}
        onNext={next}
        onSkip={skip}
        autoSpeak={settingsReady && settings.autoSpeak}
      />
    ) : item.type === "assembly" ? (
      <Assembly
        key={item.id}
        item={item}
        onAnswer={answer}
        onNext={next}
        autoSpeak={settingsReady && settings.autoSpeak}
      />
    ) : (
      <Spelling
        key={item.id}
        item={item}
        onAnswer={answer}
        onNext={next}
        autoSpeak={settingsReady && settings.autoSpeak}
      />
    );

  return (
    <main className={s.session}>
      <div className={s.top}>
        {!nativeBack && (
          <Button variant="ghost" size="icon-lg" className="size-11" onClick={leave} aria-label="Закрыть занятие">
            <X />
          </Button>
        )}
        <Progress value={(step / total) * 100} className="h-2 flex-1" />
        <span
          className={s.counter}
          aria-label={`${introduction ? "Знакомство" : "Упражнение"} ${step + 1} из ${total}`}
        >
          {step + 1} / {total}
        </span>
      </div>
      <div className={s.body}>{view}</div>
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
    </main>
  );
}
