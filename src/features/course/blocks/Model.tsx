import { Marked, useFieldMarks } from "../WordTaps";
import css from "./blocks.module.css";

export function Model({ blockId, text }: { blockId: string; text: string }) {
  return (
    <p className={css.model} lang="el">
      <Marked text={text} marks={useFieldMarks(blockId, "model")} />
    </p>
  );
}
