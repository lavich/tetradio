import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SpeakingBlock } from "../../../content/course";
import type { BlockProgress } from "../../../domain/types";
import type { BlockPatch } from "../../../storage/course";
import { Criteria } from "./Criteria";
import { Model } from "./Model";
import { SaveProblem, useSave } from "./save";
import base from "../course.module.css";
import css from "./blocks.module.css";

const silence = (audio: MediaStream) => audio.getTracks().forEach((track) => track.stop());

const PART_LABEL: Record<SpeakingBlock["part"], string> = {
  interview: "Вопросы о себе",
  monologue: "Монолог",
  roleplay: "Ролевая игра",
};
/** Речь: таймер и запись для себя (остаётся только в памяти страницы), затем образец и самопроверка. */
export function Speaking({
  block,
  progress,
  save,
}: {
  block: SpeakingBlock;
  progress: BlockProgress | undefined;
  save: (patch: BlockPatch) => Promise<unknown>;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const [checks, setChecks] = useState<number[]>(progress?.checks ?? []);
  const [review, setReview] = useState(!!progress?.done);
  const [recording, setRecording] = useState<string | null>(null);
  const { store, problem } = useSave(save);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      attempt.current++;
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stop();
      if (stream.current) silence(stream.current);
    },
    [],
  );
  useEffect(() => () => void (recording && URL.revokeObjectURL(recording)), [recording]);
  const stop = () => {
    attempt.current++;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stop();
    recorder.current = null;
    setLeft(null);
    setReview(true);
  };
  const start = async () => {
    const id = ++attempt.current;
    setLeft(block.seconds);
    timer.current = setInterval(() => setLeft((value) => (value === null ? null : value - 1)), 1000);
    // Запись необязательна: без микрофона остаётся таймер и самопроверка.
    let audio: MediaStream | undefined;
    try {
      audio = await navigator.mediaDevices?.getUserMedia({ audio: true });
      if (!audio) return;
      // Пока открыт запрос доступа, запись могли закончить или уйти с урока: микрофон сразу выключаем.
      if (id !== attempt.current) return silence(audio);
      const source = audio;
      stream.current = source;
      const chunks: Blob[] = [];
      const media = new MediaRecorder(source);
      media.ondataavailable = (event) => chunks.push(event.data);
      media.onstop = () => {
        silence(source);
        if (stream.current === source) stream.current = null;
        setRecording(URL.createObjectURL(new Blob(chunks, { type: media.mimeType })));
      };
      media.start();
      recorder.current = media;
    } catch {
      recorder.current = null;
      if (audio) silence(audio);
      if (stream.current === audio) stream.current = null;
    }
  };
  // Время вышло — запись останавливается, открываются образец и самопроверка.
  useEffect(() => {
    if (left === 0) stop();
  });
  const toggle = (index: number) => {
    const next = checks.includes(index) ? checks.filter((value) => value !== index) : [...checks, index];
    setChecks(next);
    // В выполненном задании отметка сохраняется сразу: отдельная кнопка ничего видимого не меняла.
    if (progress?.done) void store({ checks: next });
  };
  return (
    <>
      <h3 className={base.blockTitle}>Речь · {PART_LABEL[block.part]}</h3>
      <p className={base.print}>{block.prompt}</p>
      <p className={base.instruction}>Говорите вслух без подготовки, как на экзамене: до {block.seconds} с.</p>
      <div className={css.player}>
        {left === null ? (
          <Button variant="soft" size="md" onClick={() => void start()}>
            <Mic aria-hidden /> {review ? "Ещё раз" : "Начать"}
          </Button>
        ) : (
          <>
            <span className={css.timer} role="timer" aria-live="off">
              {left} с
            </span>
            <Button variant="quiet" size="sm" onClick={stop}>
              <Square aria-hidden /> Закончить
            </Button>
          </>
        )}
      </div>
      {recording ? <audio className="mt-3 w-full" controls src={recording} aria-label="Ваша запись" /> : null}
      {review ? (
        <>
          {block.model ? (
            <>
              <p className={base.instruction}>Образец ответа</p>
              <Model blockId={block.id} text={block.model} />
            </>
          ) : null}
          <Criteria criteria={block.criteria} checks={checks} toggle={toggle} />
          {progress?.done ? null : (
            <div className={base.actions}>
              <Button variant="soft" size="md" onClick={() => void store({ done: true, checks })}>
                Готово
              </Button>
            </div>
          )}
        </>
      ) : null}
      <SaveProblem problem={problem} />
    </>
  );
}
