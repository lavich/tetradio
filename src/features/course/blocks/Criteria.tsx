import css from "./blocks.module.css";

export function Criteria({
  criteria,
  checks,
  toggle,
}: {
  criteria: string[];
  checks: number[];
  toggle: (index: number) => void;
}) {
  return (
    <>
      <p className={css.selfCheck}>Самопроверка — не оценка экзаменатора</p>
      <ul className={css.criteria}>
        {criteria.map((criterion, index) => (
          <li key={index}>
            <label>
              <input type="checkbox" checked={checks.includes(index)} onChange={() => toggle(index)} />
              <span>{criterion}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}
