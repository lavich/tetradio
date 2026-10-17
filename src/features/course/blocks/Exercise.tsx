import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExerciseBlock } from "../../../content/course";
import { mistakesOf, scoreExercise, type ItemResult } from "../../../domain/course";
import { spokenAnswer, spokenChoice } from "../../../domain/spoken";
import { shuffle } from "../../../domain/learning";
import type { BlockProgress } from "../../../domain/types";
import { playText, speakPhrase, useTextAudioKind } from "../../../shared/audio";
import { useProfile } from "../../../shared/language";
import { Tick } from "../../../shared/Tick";
import type { BlockPatch } from "../../../storage/course";
import { SaveProblem, useSave } from "./save";
import base from "../course.module.css";
import { scriptOf } from "../../../domain/script";
import css from "./blocks.module.css";

const statusLabel: Record<ItemResult["status"], string> = { correct: "верно", almost: "почти", wrong: "неверно" };

function ListenAnswer({ text, audioAssetId }: { text: string; audioAssetId?: string }) {
  const profile = useProfile();
  if (useTextAudioKind(audioAssetId, profile) === "none") return null;
  return (
    <Button variant="quiet" size="sm" onClick={() => void playText(text, audioAssetId, profile)}>
      <Volume2 aria-hidden />
      Послушать ответ
    </Button>
  );
}

export function Exercise({
  block,
  progress,
  save,
}: {
  block: ExerciseBlock;
  progress: BlockProgress | undefined;
  save: (patch: BlockPatch) => Promise<unknown>;
}) {
  const profile = useProfile();
  // Вопросы и варианты бывают и по-русски: язык курса — только тексту на нём.
  const langOf = (text: string) => (scriptOf(text, profile) === profile.code ? profile.code : undefined);
  const [answers, setAnswers] = useState<Record<string, string>>(progress?.answers ?? {});
  const [checked, setChecked] = useState(!!progress?.done);
  const { store, problem } = useSave(save);
  // Выполнение пришло синхронизацией в пустое задание; начатые ответы не затираются.
  const done = !!progress?.done;
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current && !checked && !Object.keys(answers).length) setChecked(true);
    wasDone.current = done;
  }, [done, checked, answers]);
  // Выполнено на другом устройстве: счёт пришёл синхронизацией, а введённые ответы остались там.
  const elsewhere = checked && !Object.keys(answers).length;
  const score = checked && !elsewhere ? scoreExercise(block, answers, profile) : null;
  const total = score ?? (elsewhere ? progress?.score : undefined);
  const choose = (itemId: string, value: string) => {
    if (checked) return;
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
  };
  const checking = useRef(false);
  const check = async () => {
    if (checking.current) return;
    checking.current = true;
    const result = scoreExercise(block, answers, profile);
    const saved = await store({
      done: true,
      answers,
      score: { correct: result.correct, almost: result.almost, total: result.total },
      mistakes: mistakesOf(block, answers, result),
    });
    checking.current = false;
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
        <p className={`${css.prompt} ${base.soft}`} lang={profile.code}>
          Слова: {bank.join(" · ")}
        </p>
      ) : null}
      {block.items.map((item, index) => {
        const result = score?.results[item.id];
        const given = answers[item.id] ?? "";
        const spoken = result ? spokenAnswer(block.format, item.prompt, item.answer[0], profile) : null;
        return (
          <div key={item.id} className={css.item}>
            {result && result.status !== "wrong" ? (
              <Tick
                className={result.status === "almost" ? `${base.itemMark} ${base.almost}` : base.itemMark}
                label={statusLabel[result.status]}
              />
            ) : null}
            <p className={css.prompt} lang={langOf(item.prompt)}>
              <span className={base.soft}>{index + 1}. </span>
              {item.prompt}
            </p>
            {block.format === "text" ? (
              <input
                className={css.answerInput}
                lang={profile.code}
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
                    lang={langOf(option)}
                    aria-pressed={given === option}
                    disabled={checked}
                    onClick={() => {
                      choose(item.id, option);
                      const text = spokenChoice(item.prompt, option, profile);
                      if (text) void speakPhrase(text, profile);
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
                  {result.status === "almost" ? `Почти — проверьте ${profile.almost.check}: ` : "Верно: "}
                  <span lang={langOf(result.expected)}>{result.expected}</span>
                  {item.explanation ? ` — ${item.explanation}` : ""}
                </p>
              )
            ) : null}
            {spoken ? <ListenAnswer text={spoken} audioAssetId={item.audioAssetId} /> : null}
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
