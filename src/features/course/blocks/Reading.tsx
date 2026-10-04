import type { ReadingBlock } from "../../../content/course";
import { glossSpans } from "../../../content/course";
import { Marked, useFieldMarks } from "../WordTaps";
import base from "../course.module.css";
import css from "./blocks.module.css";

export function Reading({ block }: { block: ReadingBlock }) {
  const marks = useFieldMarks(block.id, "text");
  const glosses = glossSpans(block.text, block.glosses).map(({ start, length, gloss }) => ({
    start,
    length,
    text: gloss.text,
    russian: gloss.russian,
  }));
  return (
    <>
      <h3 className={`${base.blockTitle} ${base.greek}`} lang="el">
        {block.title}
      </h3>
      <p className={css.reading} lang="el">
        <Marked text={block.text} marks={marks} glosses={glosses} />
      </p>
      {block.glosses?.length ? <p className={base.instruction}>Подчёркнутые слова — нажмите для перевода.</p> : null}
    </>
  );
}
