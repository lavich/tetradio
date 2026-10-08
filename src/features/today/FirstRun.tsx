import { GraduationCap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Course } from "../../domain/types";
import { installCourse } from "../../content/client";
import { CARDS, LESSONS_COUNT, withCount } from "../../shared/format";
import { useCatalog, useCoursePhase, useCourses } from "../../shared/store";
import type { StoredCatalogEntry } from "../../storage/db";
import ui from "../../shared/ui.module.css";

/**
 * Первый запуск: на устройстве нет ни одного урока. Первый шаг — курс целиком: после загрузки «Сегодня»
 * ведёт к первому уроку, а карточки приходят из начатых уроков.
 */
export function FirstRun({ courses, entries }: { courses: Course[]; entries: StoredCatalogEntry[] }) {
  const offered = courses.filter((item) => entries.some((entry) => entry.courseId === item.id));
  if (!offered.length)
    return (
      <Card className="mb-3 bg-soft ring-0">
        <CardHeader>
          <CardTitle className="text-xl font-bold">Каталог ещё не загружен</CardTitle>
          <CardDescription className="text-foreground/75">Проверьте сеть — курс появится сам.</CardDescription>
        </CardHeader>
      </Card>
    );
  return (
    <>
      {offered.map((course) => (
        <CourseOffer key={course.id} course={course} entries={entries} />
      ))}
    </>
  );
}

function CourseOffer({ course, entries }: { course: Course; entries: StoredCatalogEntry[] }) {
  const phase = useCoursePhase(course.id);
  const own = entries.filter((entry) => entry.courseId === course.id);
  const cards = own.reduce((sum, entry) => sum + entry.cardCount, 0);
  const loading = phase.phase === "loading";
  const learn = () => void installCourse(course.id).catch(() => undefined);
  return (
    <section className="mb-6">
      <Card className="mb-3 bg-soft ring-0" data-testid="first-course">
        <CardHeader>
          <CardTitle className="text-2xl font-bold [overflow-wrap:anywhere]">{course.title}</CardTitle>
          <CardDescription className="text-foreground/75">
            {withCount(own.length, LESSONS_COUNT)} · {withCount(cards, CARDS)}
          </CardDescription>
        </CardHeader>
      </Card>
      <Button size="xl" onClick={learn} disabled={loading} aria-label={`Учить курс «${course.title}»`}>
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
        <p className={ui.hint}>Уроки загрузятся на устройство и будут доступны без сети.</p>
      )}
    </section>
  );
}

/** Начало курса там, где каталог есть, а уроков на устройстве ещё нет: на полке — выбранного курса, на «Сегодня» — любого. */
export function CourseStart({ courseId }: { courseId?: string }) {
  const courses = useCourses();
  const catalog = useCatalog();
  const offered = (courses ?? []).filter((course) => !courseId || course.id === courseId);
  return <FirstRun courses={offered} entries={catalog?.entries ?? []} />;
}
