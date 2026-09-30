import { ChevronRight, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import type { LessonProgress } from "../../domain/stats";
import { CARDS, dativeWeekday, dayMonth, shortTitle, withCount, WORDS } from "../../shared/format";
import type { LessonView } from "../../storage/queries";
import styles from "./LessonRow.module.css";

const GROUPS = [
  ["solid", ["устойчивое", "устойчивых", "устойчивых"]],
  ["review", ["в повторении", "в повторении", "в повторении"]],
  ["fresh", ["новое", "новых", "новых"]],
] as const;
/** Числа непустых групп в фиксированном порядке: «12 устойчивых · 8 в повторении · 13 новых», у нетронутого урока — «33 новых». */
export const progressText = (progress: LessonProgress) =>
  GROUPS.filter(([key]) => progress[key])
    .map(([key, forms]) => withCount(progress[key], [...forms]))
    .join(" · ");

/**
 * Полоса показывает освоенность, а не состав: закрашена средняя зрелость живых карточек урока.
 * Закрашенное делится надвое — вклад устойчивых слов и вклад остальных введённых, — чтобы было
 * видно, чем урок держится. Остаток дорожки и есть недостающая зрелость.
 */
export function progressFill(progress: LessonProgress) {
  const total = progress.solid + progress.review + progress.fresh;
  if (!total) return { solid: 0, review: 0, rest: 1, percent: 0 };
  const solid = progress.solid / total;
  const review = Math.max(0, progress.mature - progress.solid) / total;
  return { solid, review, rest: Math.max(0, 1 - solid - review), percent: Math.round((progress.mature / total) * 100) };
}

/**
 * Заголовок и подпись строки урока. Предлог «К» с днём недели получает только ближайшее занятие курса:
 * к нему готовятся сейчас, и день недели там — срок. Остальным — прошедшим и дальним — хватает даты.
 */
export const lessonLabels = (lesson: LessonView, next = false) => ({
  title: `${shortTitle(lesson.title)} · ${
    !lesson.targetDate
      ? "Без даты"
      : next
        ? `К ${dativeWeekday(lesson.targetDate)}, ${dayMonth(lesson.targetDate)}`
        : dayMonth(lesson.targetDate)
  }`,
  note: `${lesson.status === "completed" ? "проведён" : "предстоит"}${lesson.status !== "completed" && lesson.dateSource === "manual" ? " · дата вручную" : ""}`,
});

/** Строка урока: одна и та же в списках «Сегодня» и «Уроки», подписи считает сама, прогресс приходит из запроса. */
export function LessonRow({ lesson, next }: { lesson: LessonView; next?: boolean }) {
  const { title, note } = lessonLabels(lesson, next);
  const progress = lesson.cardCount ? lesson.progress : undefined;
  // «Карточки» — там, где объединяются виды; словарный урок по-прежнему считает слова.
  const composition = lesson.phraseCount ? withCount(lesson.cardCount, CARDS) : withCount(lesson.wordCount, WORDS);
  return (
    <Item variant="row" render={<Link to={`/lessons/${lesson.id}`} />}>
      <ItemMedia variant="icon">
        <FileText />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="text-base">{title}</ItemTitle>
        <ItemDescription>
          {composition} · {note}
        </ItemDescription>
        {progress && <LessonProgressBar progress={progress} />}
      </ItemContent>
      <ItemActions>
        <ChevronRight className="text-muted-foreground" />
      </ItemActions>
    </Item>
  );
}

/** Полоса освоенности и её подпись: общая для строки урока и панели ближайшего занятия на «Сегодня». */
export function LessonProgressBar({ progress }: { progress: LessonProgress }) {
  const text = progressText(progress);
  const fill = progressFill(progress);
  return (
    <>
      <div role="img" aria-label={`Освоено ${fill.percent}% · ${text}`} className={styles.bar}>
        {(
          [
            ["solid", fill.solid],
            ["review", fill.review],
            ["rest", fill.rest],
          ] as const
        ).map(
          ([key, share]) =>
            !!share && (
              <span
                key={key}
                className={styles[key]}
                style={{ flexGrow: share }}
                title={
                  key === "rest"
                    ? `Осталось освоить ${100 - fill.percent}%`
                    : withCount(progress[key], [...GROUPS.find(([name]) => name === key)![1]])
                }
              />
            ),
        )}
      </div>
      <div aria-hidden="true" className="text-xs text-muted-foreground" data-testid="lesson-progress">
        {text}
      </div>
    </>
  );
}
