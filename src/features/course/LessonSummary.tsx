import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LessonBlock } from "../../content/course";
import { SKILL_LABEL } from "../../content/course";
import { isTask, lessonDone, lessonTally, testResult } from "../../domain/course";
import type { BlockProgress, LessonItem } from "../../domain/types";
import type { CourseLesson, ModuleLessonView } from "../../storage/course";
import { useProfile } from "../../shared/language";
import { Tick } from "../../shared/Tick";
import { cx } from "../../shared/cx";
import { PHRASES, WORDS, withCount } from "../../shared/format";
import { blockLabel } from "./paginate";
import { VocabularyList } from "./Vocabulary";
import ui from "../../shared/ui.module.css";
import base from "./course.module.css";
import css from "./summary.module.css";

interface Row {
  block: LessonBlock;
  page: number;
  progress: BlockProgress | undefined;
}

export function LessonSummary({
  lesson,
  progress,
  passShare,
  pages,
  numbering,
  items,
  next,
  withList,
  problem,
  practice,
  go,
  openNext,
  toModule,
}: {
  lesson: CourseLesson;
  progress: Map<string, BlockProgress>;
  /** Порог навыка из экзамена курса; без него итог контрольной — без «сдано». */
  passShare: number | undefined;
  pages: LessonBlock[][];
  numbering: Map<string, number>;
  items: LessonItem[];
  next: ModuleLessonView | null | undefined;
  /** Карточки урока — на соседней странице разворота. */
  withList: boolean;
  problem: string;
  practice: () => void;
  go: (target: number, direction: "next" | "prev") => void;
  openNext: () => void;
  toModule: () => void;
}) {
  const complete = lessonDone(lesson.blocks, progress);
  const tally = lessonTally(lesson.blocks, progress);
  const finished = !!lesson.lesson?.completed;
  const result = lesson.kind === "test" ? testResult(lesson.blocks, progress, passShare) : null;
  const rows: Row[] = pages.flatMap((page, index) =>
    page.filter(isTask).map((block) => ({ block, page: index, progress: progress.get(block.id) })),
  );
  const pending = rows.filter((row) => !row.progress?.done);
  const title = (block: LessonBlock) =>
    numbering.get(block.id) ? `Задание ${numbering.get(block.id)}` : blockLabel(block);

  if (!finished && !complete)
    return (
      <>
        <h2 className={base.title}>Итог</h2>
        <p className={`${base.meta} mt-4`} data-testid="lesson-left">
          Осталось заданий: {tally.total - tally.done} из {tally.total} — урок завершается, когда выполнены все.
        </p>
        <ul className={css.pending}>
          {pending.map(({ block, page }) => (
            <li key={block.id}>
              <button type="button" onClick={() => go(page, "prev")}>
                {title(block)} · стр. {page + 1}
              </button>
            </li>
          ))}
        </ul>
      </>
    );

  const words = items.filter((item) => item.ref.kind === "word").length;
  const phrases = items.length - words;
  const cards = [words ? withCount(words, WORDS) : "", phrases ? withCount(phrases, PHRASES) : ""]
    .filter(Boolean)
    .join(" и ");
  const day = lesson.lesson?.updatedAt ? new Date(lesson.lesson.updatedAt) : new Date();
  return (
    <>
      <div className={css.stamp}>
        <Tick className={css.stampTick} />
        <h2 className={base.title}>Урок пройден</h2>
      </div>
      <p className={base.date}>
        {day.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} · {lesson.title}
      </p>

      {result ? (
        <section className={css.result} aria-label="Итог контрольной">
          <p className={result.passed === false ? `${base.score} ${base.failed}` : base.score}>
            Итог: {result.correct} из {result.total} ({Math.round(result.share * 100)} %)
            {passShare === undefined
              ? ""
              : ` — ${result.passed ? "порог" : "ниже порога"} ${Math.round(passShare * 100)} %${result.passed ? " пройден" : ""}`}
          </p>
          {result.skills.map((skill) => (
            <p key={skill.skill} className={base.print}>
              {SKILL_LABEL[skill.skill]}: {skill.correct} из {skill.total}
              {skill.passed === undefined ? "" : ` — ${skill.passed ? "сдано" : "не сдано"}`}
            </p>
          ))}
          <p className={base.meta}>Письмо и речь — самопроверка, в итог не входят.</p>
        </section>
      ) : null}

      <h3 className={css.heading}>Задания</h3>
      <ul className={css.rows} aria-label="Задания урока">
        {rows.map((row) => (
          <TaskRow key={row.block.id} row={row} number={numbering.get(row.block.id)} go={go} />
        ))}
      </ul>

      {items.length && !withList ? (
        <section className={css.cards} aria-label="Карточки урока">
          <p className={base.print}>{cards} урока — в повторении</p>
          <p className={base.meta}>Новые карточки — в «Повторить» на экране «Сегодня»</p>
          <Button variant="soft" size="md" className="mt-2" onClick={practice}>
            Тренировать сейчас
          </Button>
        </section>
      ) : null}
      {problem ? (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      ) : null}

      <div className={css.next}>
        {next ? (
          <Button size="xl" className={css.nextButton} onClick={openNext}>
            <span className={css.nextText}>
              <span className={css.nextLabel}>Следующий урок</span>
              {next.title}
            </span>
            <ChevronRight data-icon="inline-end" />
          </Button>
        ) : null}
        <Button variant={next ? "ghost" : "soft"} size="md" onClick={toModule}>
          К модулю
        </Button>
      </div>
    </>
  );
}

function TaskRow({
  row,
  number,
  go,
}: {
  row: Row;
  number: number | undefined;
  go: (target: number, direction: "next" | "prev") => void;
}) {
  const { syllables } = useProfile();
  const { block, page, progress } = row;
  const criteria = block.type === "writing" || block.type === "speaking" ? block.criteria.length : 0;
  let mark: { text: string; tone: "ok" | "almost" | "bad" | "soft" };
  if (!progress?.done) mark = { text: "не проверено", tone: "soft" };
  else if (block.type === "exercise" && progress.score) {
    const { correct, almost, total } = progress.score;
    const tone = correct === total ? "ok" : correct + almost === total ? "almost" : "bad";
    mark = { text: `${correct + almost}/${total}`, tone };
  } else if (criteria) {
    const checked = progress.checks?.length ?? 0;
    mark = { text: `${checked}/${criteria}`, tone: checked === criteria ? "ok" : "almost" };
  } else mark = { text: "✓", tone: "ok" };
  const label = block.type === "exercise" ? (block.title ?? block.instruction) : blockLabel(block);
  const revisit = mark.tone !== "ok";
  return (
    <li className={css.row}>
      <span className={css.number}>{number ?? ""}</span>
      <span className={css.label}>{label}</span>
      <span className={cx(css.mark, css[mark.tone])}>{mark.text}</span>
      {revisit ? (
        <button type="button" className={cx(css.revisit, css[mark.tone])} onClick={() => go(page, "prev")}>
          {block.type === "exercise" && progress?.score?.almost && mark.tone === "almost"
            ? syllables
              ? "без ударения — посмотреть"
              : "с опечаткой — посмотреть"
            : "посмотреть"}{" "}
          · стр. {page + 1}
        </button>
      ) : null}
    </li>
  );
}

/** Правая страница разворота рядом с итогом: что из урока теперь в повторении. */
export function LessonReview({ items, practice }: { items: LessonItem[]; practice: () => void }) {
  return (
    <>
      <h2 className={base.title}>В повторении</h2>
      <p className={base.date}>Новые карточки — в «Повторить» на экране «Сегодня»</p>
      <div className={css.review}>
        <VocabularyList items={items} />
      </div>
      <div className={base.actions}>
        <Button variant="soft" size="md" onClick={practice}>
          Тренировать сейчас
        </Button>
      </div>
    </>
  );
}
