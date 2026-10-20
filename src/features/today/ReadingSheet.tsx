import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { Link, useNavigate } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { cx } from "../../shared/cx";
import { withCount, WORDS } from "../../shared/format";
import { useProfile } from "../../shared/language";
import nb from "../../shared/notebook.module.css";
import { Tick } from "../../shared/Tick";
import { reportError } from "../../reporting/reporting";
import { followCourse } from "../../storage/courses";
import type { CourseReadings } from "../../storage/readings";
import css from "./today.module.css";

const TEXTS: [string, string, string] = ["текст", "текста", "текстов"];

/** Лист «Чтение» под листом «Повторение»: непрочитанные открытые тексты — не долг перед уроком, урока он не блокирует. */
export function ReadingSheet({
  courseId,
  readings,
  primary,
}: {
  courseId: string;
  readings: CourseReadings;
  primary: boolean;
}) {
  const heading = useId();
  const navigate = useNavigate();
  const { code } = useProfile();
  const { open, unread, closed, closedAfter, pending } = readings;
  // Пока часть пакетов не скачана, счёт закрытых и «Нет текстов» неполны; открытых нет вовсе — лист нечему показать.
  if (pending > 0 ? !open.length : !open.length && !closed) return null;
  const first = unread[0];
  const later =
    closedAfter && !pending ? (
      <p className={nb.meta}>Следующий текст откроется после урока «{closedAfter.title}»</p>
    ) : null;
  const downloading = pending > 0 ? <p className={nb.meta}>Часть текстов ещё скачивается.</p> : null;
  // «Сегодня» показывает основной курс, а вкладка — выбранный: без ожидания на кадр мелькнул бы прежний.
  const all = (
    <Link
      to="/reading"
      className={cx(css.quiet, css.linkQuiet)}
      data-testid="reading-all"
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        void (async () => {
          try {
            await followCourse(courseId);
          } catch (error) {
            void reportError(error, { category: "storage" });
          } finally {
            void navigate("/reading");
          }
        })();
      }}
    >
      Все тексты
    </Link>
  );

  if (first)
    return (
      <section className={css.sheet} aria-labelledby={heading} data-testid="reading-sheet">
        <div className={css.sheetHead}>
          <span className={css.count} role="img" aria-label={`непрочитанных текстов: ${unread.length}`}>
            {unread.length}
          </span>
          <div className="min-w-0">
            <h2 id={heading} className={css.sheetTitle}>
              Чтение
            </h2>
            <p className={nb.meta} data-testid="reading-today">
              <span lang={code} className={css.greekTitle}>
                {first.reading.title}
              </span>{" "}
              · {withCount(first.reading.words, WORDS)}
            </p>
            {downloading}
          </div>
        </div>
        <Link
          to={`/course/${first.moduleId}/read/${first.reading.id}`}
          className={cn(
            buttonVariants({ variant: primary ? "default" : "soft", size: "md" }),
            !primary && "border-primary",
          )}
          data-primary={primary}
        >
          Читать
          {primary && <ArrowRight data-icon="inline-end" />}
        </Link>
        {all}
      </section>
    );

  return (
    <section className={cx(css.sheet, css.trace)} aria-labelledby={heading} data-testid="reading-sheet">
      <div className={css.sheetHead}>
        {open.length ? <Tick className={css.bigTick} label="всё прочитано" /> : <span className={css.blank} />}
        <div className="min-w-0">
          <h2 id={heading} className={cx(css.sheetTitle, !open.length && css.later)}>
            Чтение
          </h2>
          {open.length ? <p className={nb.meta}>Прочитано {withCount(open.length, TEXTS)}</p> : later}
          {open.length ? downloading : null}
        </div>
      </div>
      {open.length ? later : null}
      {open.length ? all : null}
    </section>
  );
}
