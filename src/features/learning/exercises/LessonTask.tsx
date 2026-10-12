import { useEffect, useId, useState } from "react";
import { checkItem } from "../../../domain/course";
import { instructionOf } from "../../../domain/item-exercise";
import type { MistakeItem } from "../../../domain/types";
import { useProfile } from "../../../shared/language";
import exercise from "./exercise.module.css";
import s from "./spelling.module.css";
import { Choice } from "./Choice";
import type { ExerciseProps, Status } from "./model";
import { useRevealed, focusWithKeyboard } from "./hooks";
import { Primary, QuietActions, QuietButton, TaskHead, Verdict } from "./parts";

const taskOf = (props: ExerciseProps): MistakeItem => {
  const { card } = props.item;
  if (card.kind !== "mistake") throw new Error("Задание урока получило другую карточку");
  return card.mistake;
};
const Explanation = ({ task }: { task: MistakeItem }) =>
  task.explanation ? <p className={exercise.hint}>{task.explanation}</p> : null;

/** Вопросы и варианты заданий бывают и по-русски: язык курса ставится только тексту на нём. */
const useLang = () => {
  const profile = useProfile();
  return (text: string) => (profile.script.test(text) ? profile.code : undefined);
};

/** Пункт задания урока в своём формате: ввод проверяется так же, как в уроке, выбор — по ключу. */
export function LessonTask(props: ExerciseProps) {
  const task = taskOf(props);
  const lang = useLang();
  if (task.format === "text") return <TextTask {...props} task={task} />;
  return (
    <Choice
      {...props}
      prompt={instructionOf(task)}
      correct={task.answer[0]}
      options={props.item.options}
      greekOptions={props.item.options.some((option) => !!lang(option))}
      head={
        <p className={exercise.phrase} lang={lang(task.prompt)}>
          {task.prompt}
        </p>
      }
      after={<Explanation task={task} />}
    />
  );
}

function TextTask({ item, onAnswer, onNext, nextLabel = "Далее", task }: ExerciseProps & { task: MistakeItem }) {
  const formId = useId();
  const profile = useProfile();
  const lang = useLang();
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{ status: Status; expected: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const revealed = useRevealed(!!result);
  useEffect(() => {
    setValue("");
    setResult(null);
    setSaving(false);
  }, [item.id]);
  const answer = async (text: string) => {
    if (result || saving) return;
    const checked = checkItem({ format: "text" }, task, text, profile);
    setSaving(true);
    const saved = await onAnswer({ correct: checked.status === "correct", text, status: checked.status });
    setSaving(false);
    if (saved) setResult(checked);
  };
  if (result)
    return (
      <>
        <div ref={revealed}>
          <TaskHead prompt={instructionOf(task)} meaning={task.prompt} />
          {value && (
            <p className={exercise.written} lang={lang(value)}>
              {value}
            </p>
          )}
          <Verdict status={result.status}>
            <p>
              {result.status === "correct" ? (
                "Верно."
              ) : (
                <>
                  {result.status === "almost" ? `${profile.almost.message} ` : ""}Ответ:{" "}
                  <span lang={lang(result.expected)}>{result.expected}</span>
                </>
              )}
            </p>
          </Verdict>
          <Explanation task={task} />
        </div>
        <Primary focus onClick={onNext}>
          {nextLabel}
        </Primary>
      </>
    );
  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) void answer(value);
      }}
    >
      <TaskHead prompt={instructionOf(task)} meaning={task.prompt} />
      <div className={s.field}>
        <input
          ref={focusWithKeyboard}
          className={s.answer}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={saving}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label={`Твой ответ ${profile.names.in}`}
          lang={profile.code}
        />
      </div>
      <QuietActions>
        <QuietButton disabled={saving} onClick={() => void answer("")}>
          Не знаю
        </QuietButton>
      </QuietActions>
      <Primary form={formId} disabled={!value.trim() || saving}>
        {saving ? "Сохраняем…" : "Проверить"}
      </Primary>
    </form>
  );
}
