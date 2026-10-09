import { useProfile } from "../../../shared/language";
import { Marked, useFieldMarks } from "../WordTaps";
import css from "./blocks.module.css";

export function Model({ blockId, text }: { blockId: string; text: string }) {
  const { code } = useProfile();
  return (
    <p className={css.model} lang={code}>
      <Marked text={text} marks={useFieldMarks(blockId, "model")} />
    </p>
  );
}
