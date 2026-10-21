import { Link } from "react-router-dom";
import { eventDay, WORDS, withCount } from "../../shared/format";
import { Tick } from "../../shared/Tick";
import type { ReadingView } from "../../storage/readings";
import base from "./course.module.css";
import css from "./module-screen.module.css";

export function ReadingRow({
  view,
  code,
  state,
  level = 3,
}: {
  view: ReadingView;
  code: string;
  state: object;
  level?: 3 | 4;
}) {
  const { reading, open, readAt, after, moduleId } = view;
  const Heading = level === 3 ? "h3" : "h4";
  const title = (
    <span className={css.tocLine}>
      <Heading className={css.blockTitle} lang={code}>
        {reading.title}
      </Heading>
      <span className={css.dots} aria-hidden="true" />
      <span className={css.tocCount}>{withCount(reading.words, WORDS)}</span>
    </span>
  );
  const meta = readAt ? `прочитано ${eventDay(readAt)}` : open ? null : <>откроется после урока «{after.title}»</>;
  return (
    <li>
      {readAt ? <Tick className={base.mark} label="прочитано" /> : <span className={base.gutter}>текст</span>}
      {open ? (
        <Link className={css.lessonLink} to={`/course/${moduleId}/read/${reading.id}`} state={state}>
          {title}
          {meta ? <span className={css.meta}>{meta}</span> : null}
        </Link>
      ) : (
        <div className={css.lessonLink}>
          {title}
          <span className={css.meta}>{meta}</span>
        </div>
      )}
    </li>
  );
}
