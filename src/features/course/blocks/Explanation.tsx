import type { ExplanationBlock } from "../../../content/course";
import { Marked, useFieldMarks } from "../WordTaps";
import { paragraphs, Rich } from "./Rich";
import base from "../course.module.css";
import css from "./blocks.module.css";

export function Explanation({ block }: { block: ExplanationBlock }) {
  const marks = useFieldMarks(block.id, "body");
  return (
    <>
      {block.title ? <h3 className={base.blockTitle}>{block.title}</h3> : null}
      {paragraphs(block.body).map(({ from, to }) => (
        <p key={from} className={base.print}>
          <Rich text={block.body} from={from} to={to} marks={marks} />
        </p>
      ))}
      {block.table ? (
        <table className={css.table}>
          {block.table.columns ? (
            <thead>
              <tr>
                {block.table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {block.table.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, at) => (
                  <td key={at}>
                    <Cell blockId={block.id} field={`table.${index}.${at}`} text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

function Cell({ blockId, field, text }: { blockId: string; field: string; text: string }) {
  return <Marked text={text} marks={useFieldMarks(blockId, field)} />;
}
