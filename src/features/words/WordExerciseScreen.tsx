import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { buildWordExercise, wordExerciseOptions } from "../../domain/learning";
import { unitKey, wordRef } from "../../domain/refs";
import type { SessionItem } from "../../domain/types";
import { hapticsEnabled } from "../../platform/haptics";
import { useBackHandler, useHaptics, usePlatform } from "../../platform/platform";
import { stopAudio, useGreekVoice } from "../../shared/audio";
import { useSettings } from "../../shared/store";
import { db } from "../../storage/db";
import { Assembly, Comprehension, Listening, Recognition, Spelling, type Answer } from "../learning/exercises";
import { PlaceProvider } from "../learning/notebook";
import { EXERCISE_LABELS, isWordExercise, wordSources } from "./word-exercises";
import ui from "../../shared/ui.module.css";
import s from "../learning/session.module.css";

/**
 * Упражнение, выбранное пользователем на странице слова. Задание живёт только в памяти экрана:
 * ответ проверяется и раскрывается как в занятии, но нигде не записывается — ни событие, ни срок, ни занятие.
 * Модуль намеренно не импортирует операций записи.
 */
export function WordExerciseScreen() {
  const { id = "", type } = useParams();
  const navigate = useNavigate();
  const word = useLiveQuery(async () => (await db.words.get(id)) ?? null, [id]);
  const voice = useGreekVoice();
  const { settings, ready } = useSettings();
  const haptic = useHaptics();
  const nativeBack = usePlatform().capabilities.back;
  const [attempt, setAttempt] = useState(0);
  const [item, setItem] = useState<SessionItem | null | undefined>(undefined);
  const [reason, setReason] = useState("");
  const live = word && !word.deletedAt ? word : null;

  const back = useCallback(() => {
    stopAudio();
    void navigate(`/words/${encodeURIComponent(id)}`, { replace: true });
  }, [id, navigate]);
  useBackHandler(back);

  useEffect(() => {
    if (!live || !isWordExercise(type)) return;
    let alive = true;
    void wordSources(live.id).then((sources) => {
      if (!alive) return;
      const exercise = buildWordExercise(live, type, sources, Math.random, voice);
      if (!exercise) {
        const status = wordExerciseOptions(live, sources, voice)[type];
        setReason(status.available ? "" : status.reason);
        return setItem(null);
      }
      setItem({
        id: `free-${Date.now().toString(36)}-${attempt}`,
        ref: wordRef(live.id),
        unitKey: unitKey(wordRef(live.id)),
        card: { kind: "word", word: live },
        ...exercise,
        isNew: false,
        mode: "practice",
        expectedVersion: 0,
      });
    });
    return () => {
      alive = false;
    };
    // Задание собирается один раз на попытку: правка слова или загрузка голоса не должны подменять его посреди ответа.
  }, [live?.id, type, attempt, item === null ? voice : undefined]);
  useEffect(() => () => void stopAudio(), []);

  const answer = async ({ correct, status }: Answer) => {
    if (hapticsEnabled()) haptic(status === "almost" ? "warning" : correct ? "success" : "error");
    return true;
  };
  const again = () => {
    stopAudio();
    setAttempt((n) => n + 1);
  };
  const title = isWordExercise(type) ? EXERCISE_LABELS[type] : "Упражнение";
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const shell = (body: React.ReactNode, sheet = true) => (
    <main className={s.session}>
      <div className={s.page}>
        {sheet ? (
          <section className={s.sheet} aria-label={title}>
            <PlaceProvider value={{ slot }}>{body}</PlaceProvider>
          </section>
        ) : (
          body
        )}
      </div>
      <div className={s.cloud} role="group" aria-label={title}>
        {!nativeBack && (
          <Button variant="ghost" size="icon-lg" className={s.close} onClick={back} aria-label="К слову">
            <X />
          </Button>
        )}
        <span className={s.count}>
          <span>{title}</span>
          <small>Без учёта прогресса</small>
        </span>
        <span ref={setSlot} className="contents" />
      </div>
    </main>
  );
  const message = (text: string) =>
    shell(
      <div className="flex flex-col gap-3 py-6">
        <p className={ui.muted}>{text}</p>
        <Button size="xl" onClick={back}>
          К слову
        </Button>
      </div>,
      false,
    );

  if (word === undefined) return shell(<Skeleton className="h-48 w-full" />, false);
  if (!live) return message("Слово не найдено.");
  if (!isWordExercise(type)) return message("Упражнение недоступно.");
  if (item === undefined) return shell(<Skeleton className="h-48 w-full" />, false);
  if (item === null) return message(`Это упражнение для слова недоступно. ${reason}`.trim());

  const props = { item, onAnswer: answer, onNext: again, nextLabel: "Ещё раз" };
  const autoSpeak = ready && settings.autoSpeak;
  const view =
    item.type === "recognition" ? (
      <Recognition key={item.id} {...props} autoSpeak={autoSpeak} />
    ) : item.type === "listening" ? (
      <Listening key={item.id} {...props} onSkip={back} autoSpeak={autoSpeak} />
    ) : item.type === "comprehension" ? (
      <Comprehension key={item.id} {...props} onSkip={back} autoSpeak={autoSpeak} />
    ) : item.type === "assembly" ? (
      <Assembly key={item.id} {...props} autoSpeak={autoSpeak} />
    ) : (
      <Spelling key={item.id} {...props} autoSpeak={autoSpeak} />
    );
  return shell(view);
}
