import { Button } from "@/components/ui/button";
import type { LessonBlock } from "../../content/course";
import { SKILL_LABEL } from "../../content/course";
import { isTask, lessonDone, lessonTally, testResult } from "../../domain/course";
import type { BlockProgress } from "../../domain/types";
import type { CourseLesson } from "../../storage/course";
import { blockLabel } from "./paginate";
import ui from "../../shared/ui.module.css";
import base from "./course.module.css";
import css from "./summary.module.css";

export function LessonSummary({
  lesson,
  progress,
  pages,
  numbering,
  problem,
  finish,
  go,
}: {
  lesson: CourseLesson;
  progress: Map<string, BlockProgress>;
  pages: LessonBlock[][];
  numbering: Map<string, number>;
  problem: string;
  finish: () => Promise<void>;
  go: (target: number, direction: "next" | "prev") => void;
}) {
  const complete = lessonDone(lesson.blocks, progress);
  const tally = lessonTally(lesson.blocks, progress);
  const finished = !!lesson.lesson?.completed;
  const result = lesson.kind === "test" ? testResult(lesson.blocks, progress) : null;
  const pending = pages.flatMap((page, index) =>
    page.filter((block) => isTask(block) && !progress.get(block.id)?.done).map((block) => ({ block, index })),
  );
  return (
    <>
      <h2 className={base.title}>Итог</h2>
      {result && complete ? (
        <section className={css.result} aria-label="Итог контрольной">
          <p className={result.passed ? base.score : `${base.score} ${base.failed}`}>
            Итог: {result.correct} из {result.total} ({Math.round(result.share * 100)} %) —{" "}
            {result.passed ? "порог 60 % пройден" : "ниже порога 60 %"}
          </p>
          {result.skills.map((skill) => (
            <p key={skill.skill} className={base.print}>
              {SKILL_LABEL[skill.skill]}: {skill.correct} из {skill.total} — {skill.passed ? "сдано" : "не сдано"}
            </p>
          ))}
          <p className={base.meta}>Письмо и речь — самопроверка, в итог не входят.</p>
        </section>
      ) : null}
      {problem ? (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      ) : null}
      {finished ? (
        <p className={`${base.score} mt-8`}>Урок пройден</p>
      ) : complete ? (
        <div className={css.dock}>
          <Button size="xl" onClick={() => void finish()}>
            Завершить урок
          </Button>
        </div>
      ) : (
        <>
          <p className={`${base.meta} mt-4`} data-testid="lesson-left">
            Осталось заданий: {tally.total - tally.done} из {tally.total} — урок завершается, когда выполнены все.
          </p>
          <ul className={css.pending}>
            {pending.map(({ block, index }) => (
              <li key={block.id}>
                <button type="button" onClick={() => go(index, "prev")}>
                  {numbering.get(block.id) ? `Задание ${numbering.get(block.id)}` : blockLabel(block)} · стр.{" "}
                  {index + 1}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
