import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WritingBlock } from "../../../content/course";
import { wordCount } from "../../../domain/course";
import type { BlockProgress } from "../../../domain/types";
import type { BlockPatch } from "../../../storage/course";
import { Criteria } from "./Criteria";
import { Model } from "./Model";
import { SaveProblem, useSave } from "./save";
import base from "../course.module.css";
import css from "./blocks.module.css";

export function Writing({
  block,
  progress,
  save,
}: {
  block: WritingBlock;
  progress: BlockProgress | undefined;
  save: (patch: BlockPatch) => Promise<unknown>;
}) {
  const [text, setText] = useState(progress?.text ?? "");
  const [checks, setChecks] = useState<number[]>(progress?.checks ?? []);
  const [review, setReview] = useState(!!progress?.done);
  const { store, problem } = useSave(save);
  const draft = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flush] = useState(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (draft.current === null) return;
    void store({ text: draft.current });
    draft.current = null;
  });
  // Мини-приложение закрывают без blur: черновик пишется по ходу набора и при уходе страницы в фон.
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);
  const count = wordCount(text);
  const toggle = (index: number) => {
    const next = checks.includes(index) ? checks.filter((value) => value !== index) : [...checks, index];
    setChecks(next);
    // В выполненном задании отметка сохраняется сразу: отдельная кнопка ничего видимого не меняла.
    if (progress?.done) void store({ checks: next });
  };
  return (
    <>
      <h3 className={base.blockTitle}>{block.register === "formal" ? "Официальный текст" : "Письмо"}</h3>
      <p className={base.print}>{block.prompt}</p>
      <p className={base.instruction}>
        {block.words.min}–{block.words.max} слов · сейчас {count}
      </p>
      <textarea
        className={css.writing}
        lang="el"
        aria-label="Ваш текст"
        autoComplete="off"
        autoCapitalize="sentences"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          draft.current = event.target.value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 800);
        }}
        onBlur={flush}
      />
      {review ? (
        <>
          <p className={base.instruction}>Образец</p>
          <Model blockId={block.id} text={block.model} />
          <Criteria criteria={block.criteria} checks={checks} toggle={toggle} />
          {progress?.done ? null : (
            <div className={base.actions}>
              <Button
                variant="soft"
                size="md"
                onClick={() => {
                  draft.current = null;
                  void store({ done: true, text, checks });
                }}
              >
                Готово
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className={base.actions}>
          <Button
            variant="soft"
            size="md"
            disabled={count < block.words.min}
            onClick={() => {
              setReview(true);
              draft.current = text;
              flush();
            }}
          >
            Сравнить с образцом
          </Button>
        </div>
      )}
      <SaveProblem problem={problem} />
    </>
  );
}
