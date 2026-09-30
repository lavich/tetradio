import { BookOpen, GraduationCap, RefreshCw, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Course } from "../../domain/types";
import { installCourse } from "../../content/client";
import { CARDS, LESSONS_COUNT, withCount } from "../../shared/format";
import { useCoursePhase } from "../../shared/store";
import type { StoredCatalogEntry } from "../../storage/db";
import ui from "../../shared/ui.module.css";

/**
 * Первый запуск: на устройстве нет ни одного урока. Первый шаг — курс целиком, как «Учить курс» на «Уроках»:
 * после загрузки план сразу даёт карточки на сегодня, а расписание занятий задаётся потом, когда оно нужно.
 */
export function FirstRun({ courses, entries }: { courses: Course[]; entries: StoredCatalogEntry[] }) {
  const course = courses.find(
    (item) => item.origin === "content" && entries.some((entry) => entry.courseId === item.id),
  );
  const phase = useCoursePhase(course?.id);

  if (!course)
    return (
      <>
        <Card className="mb-3 bg-soft ring-0">
          <CardHeader>
            <CardTitle className="text-xl font-bold">Каталог ещё не загружен</CardTitle>
            <CardDescription className="text-foreground/75">
              Проверьте сеть — курс появится сам. Или начните со своих слов из Quizlet.
            </CardDescription>
          </CardHeader>
        </Card>
        <Link to="/more/import" className={buttonVariants({ variant: "soft", size: "xl" })}>
          <Upload data-icon="inline-start" />
          Импортировать слова
        </Link>
      </>
    );

  const own = entries.filter((entry) => entry.courseId === course.id);
  const cards = own.reduce((sum, entry) => sum + entry.cardCount, 0);
  const loading = phase.phase === "loading";
  const learn = () => void installCourse(course.id).catch(() => undefined);
  return (
    <>
      <Card className="mb-3 bg-soft ring-0" data-testid="first-course">
        <CardHeader>
          <CardTitle className="text-2xl font-bold [overflow-wrap:anywhere]">{course.title}</CardTitle>
          <CardDescription className="text-foreground/75">
            {withCount(own.length, LESSONS_COUNT)} · {withCount(cards, CARDS)}
          </CardDescription>
        </CardHeader>
      </Card>
      <Button size="xl" onClick={learn} disabled={loading}>
        <GraduationCap data-icon="inline-start" />
        {loading ? "Загружаем курс…" : "Учить курс"}
      </Button>
      {phase.phase === "error" ? (
        <div className="mt-2">
          <p className={ui.error} role="alert" data-testid="course-error">
            {phase.message}
          </p>
          <Button size="md" variant="quiet" onClick={learn}>
            <RefreshCw data-icon="inline-start" />
            Повторить
          </Button>
        </div>
      ) : (
        <p className={ui.hint}>Уроки загрузятся на устройство; расписание занятий можно задать потом.</p>
      )}
      <Link to="/lessons" className={cn(buttonVariants({ variant: "soft", size: "md" }), "mt-4")}>
        <BookOpen data-icon="inline-start" />
        Выбрать отдельный урок
      </Link>
    </>
  );
}
