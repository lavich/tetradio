import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ExerciseBlock } from "../../../content/course";
import { scoreExercise, spokenChoice, type ItemResult } from "../../../domain/course";
import { shuffle } from "../../../domain/learning";
import type { BlockProgress } from "../../../domain/types";
import { speakPhrase } from "../../../shared/audio";
import { Tick } from "../../../shared/Tick";
import type { BlockPatch } from "../../../storage/course";
import { SaveProblem, useSave } from "./save";
import base from "../course.module.css";
import css from "./blocks.module.css";

const statusLabel: Record<ItemResult["status"], string> = { correct: "верно", almost: "почти", wrong: "неверно" };

export function Exercise({
  block,
  progress,
  save,
}: {
  block: ExerciseBlock;
  progress: BlockProgress | undefined;
  save: (patch: BlockPatch) => Promise<unknown>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(progress?.answers ?? {});
  const [checked, setChecked] = useState(!!progress?.done);
  const { store, problem } = useSave(save);
  // Выполнено на другом устройстве: счёт пришёл синхронизацией, а введённые ответы остались там.
  const elsewhere = checked && !Object.keys(answers).length;
  const score = checked && !elsewhere ? scoreExercise(block, answers) : null;
  const total = score ?? (elsewhere ? progress?.score : undefined);
  const choose = (itemId: string, value: string) => {
    if (checked) return;
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
  };
  const check = async () => {
    const result = scoreExercise(block, answers);
    const saved = await store({
      done: true,
      answers,
      score: { correct: result.correct, almost: result.almost, total: result.total },
    });
    if (saved) setChecked(true);
  };
  const retry = async () => {
    setChecked(false);
    setAnswers({});
    setOrder(mix());
    setBank(shuffle(block.bank ?? [], Math.random));
    await store({ done: false, answers: {}, score: undefined });
  };
  // Порядок вариантов в контенте часто совпадает с порядком пунктов — без перемешивания ответ угадывается.
  const mix = () =>
    Object.fromEntries(
      block.items.map((item) => {
        const options = item.options ?? block.bank ?? [];
        return [item.id, options.length > 2 ? shuffle(options, Math.random) : options];
      }),
    );
  const [order, setOrder] = useState(mix);
  const [bank, setBank] = useState(() => shuffle(block.bank ?? [], Math.random));
  const answered = block.items.every((item) => (answers[item.id] ?? "").trim());
  return (
    <>
      {block.title ? <h3 className={base.blockTitle}>{block.title}</h3> : null}
      <p className={base.instruction}>{block.instruction}</p>
      {block.bank && block.format === "gap" ? (
        <p className={`${css.prompt} ${base.soft}`} lang="el">
          Слова: {bank.join(" · ")}
        </p>
      ) : null}
      {block.items.map((item, index) => {
        const result = score?.results[item.id];
        const given = answers[item.id] ?? "";
        return (
          <div key={item.id} className={css.item}>
            {result && result.status !== "wrong" ? (
              <Tick
                className={result.status === "almost" ? `${base.itemMark} ${base.almost}` : base.itemMark}
                label={statusLabel[result.status]}
              />
            ) : null}
            <p className={css.prompt} lang="el">
              <span className={base.soft}>{index + 1}. </span>
              {item.prompt}
            </p>
            {block.format === "text" ? (
              <input
                className={css.answerInput}
                lang="el"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={`Ответ ${index + 1}`}
                value={given}
                readOnly={checked}
                onChange={(event) => choose(item.id, event.target.value)}
              />
            ) : (
              <div className={css.options} role="group" aria-label={`Варианты ${index + 1}`}>
                {(order[item.id] ?? []).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={css.option}
                    lang="el"
                    aria-pressed={given === option}
                    disabled={checked}
                    onClick={() => {
                      choose(item.id, option);
                      const text = spokenChoice(item.prompt, option);
                      if (text) void speakPhrase(text);
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            {result ? (
              result.status === "correct" ? null : (
                <p className={result.status === "almost" ? `${base.pen} ${base.almost}` : base.pen}>
                  {result.status === "almost" ? "Почти — проверьте ударение: " : "Верно: "}
                  <span lang="el">{result.expected}</span>
                  {item.explanation ? ` — ${item.explanation}` : ""}
                </p>
              )
            ) : null}
          </div>
        );
      })}
      <div className={base.actions}>
        {checked ? (
          <>
            <span
              className={
                total && total.correct + total.almost < total.total ? `${base.score} ${base.almost}` : base.score
              }
              role="status"
            >
              {total ? `${total.correct + total.almost} из ${total.total}` : "Выполнено"}
              {elsewhere ? " · на другом устройстве" : ""}
            </span>
            <Button variant="quiet" size="sm" onClick={() => void retry()}>
              Ещё раз
            </Button>
          </>
        ) : (
          <Button variant="soft" size="md" disabled={!answered} onClick={() => void check()}>
            Проверить
          </Button>
        )}
      </div>
      <SaveProblem problem={problem} />
    </>
  );
}
