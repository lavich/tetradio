import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { useAction } from "../../shared/action";
import { stopAudio } from "../../shared/audio";
import { useActiveSession, useSettings } from "../../shared/store";
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
import { compositionLine, DoneList, doneRows, PageHead, PlaceProvider, useWide } from "./notebook";
import ui from "../../shared/ui.module.css";
import s from "./session.module.css";

export function SessionScreen() {
  const navigate = useNavigate();
  const { settings, ready: settingsReady } = useSettings();
  const other = useActiveSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Сессию держим по id: последний ответ переводит её в done, но экран должен дорисовать обратную связь.
  // `undefined` — ещё читается, `null` — активного занятия нет.
  const session = useLiveQuery(
    async () =>
      (await (sessionId
        ? db.sessions.get(sessionId)
        : db.sessions
            .orderBy("id")
            .reverse()
            .filter((entry) => entry.status === "active")
            .first())) ?? null,
    [sessionId],
  );
  const events = useLiveQuery(
    async () =>
      new Map(
        session
          ? (await db.events.where("sessionId").equals(session.id).toArray()).map((event) => [event.id, event])
          : [],
      ),
    [session?.id],
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
  const leaveRef = useRef<() => void>(() => navigate("/", { replace: true }));
  const [backHandler] = useState(() => () => leaveRef.current());
  useBackHandler(backHandler);
  const item = session && position >= 0 ? session.items[position] : undefined;
  // Общий проход знакомств всех новых видов завершается до проверок; пройденное знакомство хранится по ключу карточки.
  const introduction = session?.items.find(
    (entry) => entry.isNew && !entry.eventId && !entry.retryOf && !session.introducedKeys?.includes(entry.unitKey),
  );
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const scroller = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const wide = useWide();
  const doneCount =
    session?.items.slice(0, Math.max(position, 0)).filter((entry) => entry.eventId || entry.skipped).length ?? 0;
  const { folded, setOpened } = useFold(scroller, sheet, doneCount, `${item?.id}:${introduction?.unitKey}`, wide);
  // Клавиатура уменьшает высоту окна, а не прокручивает лист: поле ввода возвращаем в видимую часть сами.
  useEffect(() => {
    const main = scroller.current;
    if (!main) return;
    const observer = new ResizeObserver(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && main.contains(focused) && focused.matches("input, textarea"))
        focused.scrollIntoView({ block: "nearest" });
    });
    observer.observe(main);
    return () => observer.disconnect();
  }, [session === undefined || preparing]);

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

  const loading = session === undefined || preparing;
  if (loading || !session || !item) {
    return (
      <main className={s.session}>
        {loading ? (
          <div className="flex flex-col gap-3 py-6">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-6">
            <p className={ui.muted}>Активного занятия нет.</p>
            <Button size="xl" onClick={() => navigate(other ? "/session" : "/")}>
              На главную
            </Button>
          </div>
        )}
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
    void navigate("/", { replace: true });
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

  const rows = doneRows({ items: session.items.slice(0, position) }, events ?? new Map());
  return (
    <main className={s.session} ref={scroller}>
      <div className={s.page}>
        <PageHead day={session.planDate} />
        <DoneList rows={rows} folded={folded} onToggle={() => setOpened(!!folded)} />
        <section ref={sheet} className={s.sheet} aria-label={introduction ? "Знакомство" : "Задание"}>
          <PlaceProvider value={{ number: introduction ? undefined : rows.length + 1, slot, inline: wide }}>
            {view}
          </PlaceProvider>
          {problem && (
            <p className={s.problem} role="alert">
              {problem}
            </p>
          )}
        </section>
      </div>
      <div className={s.cloud} role="group" aria-label="Занятие" data-cloud>
        {!nativeBack && (
          <Button variant="ghost" size="icon-lg" className={s.close} onClick={leave} aria-label="Закрыть занятие">
            <X />
          </Button>
        )}
        <span className={s.count} aria-label={`${introduction ? "Знакомство" : "Упражнение"} ${step + 1} из ${total}`}>
          <span>
            {step + 1} из {total}
          </span>
          <small>{introduction ? "знакомство с новым" : compositionLine(session.items)}</small>
        </span>
        <span ref={setSlot} className="contents" />
      </div>
    </main>
  );
}

const ROW = 48;
/**
 * Сворачивание сделанного на телефоне: если шапка, список и лист вместе не помещаются в окно, список
 * уходит в строку «Сделано N — показать». Решение принимается на задание: внутри одного задания список
 * только сворачивается (выросло раскрытие), иначе он прыгал бы туда-обратно при каждом ответе.
 * Высоту скрытого списка берём из последнего замера, а для новых строк — по две клетки на строку.
 */
function useFold(
  scroller: React.RefObject<HTMLElement | null>,
  sheet: React.RefObject<HTMLElement | null>,
  rows: number,
  task: string,
  wide: boolean,
) {
  const [fold, setFold] = useState(false);
  const [opened, setOpened] = useState(false);
  const measured = useRef({ rows: 0, height: 0 });
  // `undefined` — сворачивать нечего: строка «Сделано N» появляется только там, где список правда мешает листу.
  const folded = wide || !fold ? undefined : !opened;
  const tooTall = () => {
    const main = scroller.current,
      card = sheet.current;
    if (!main || !card || !rows) return false;
    const list = main.querySelector<HTMLElement>("[data-done-list]");
    if (list) measured.current = { rows, height: list.offsetHeight };
    const known = measured.current;
    const listHeight = list ? list.offsetHeight : Math.max(rows * ROW, known.height + (rows - known.rows) * ROW);
    const head = main.querySelector<HTMLElement>("header")?.offsetHeight ?? 0;
    const cloud = main.querySelector<HTMLElement>("[data-cloud]")?.offsetHeight ?? 0;
    const style = getComputedStyle(main);
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 48;
    return head + listHeight + card.offsetHeight + cloud + chrome > main.clientHeight;
  };
  useLayoutEffect(() => {
    if (!wide) setFold(tooTall());
  }, [task, wide]);
  useEffect(() => {
    const main = scroller.current,
      card = sheet.current;
    if (!main || !card || wide) return;
    const observer = new ResizeObserver(() => {
      if (tooTall()) setFold(true);
    });
    observer.observe(main);
    observer.observe(card);
    return () => observer.disconnect();
  }, [task, wide, rows]);
  return { folded, setOpened };
}
