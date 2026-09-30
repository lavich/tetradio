import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { nextCourseLesson } from "../../storage/course";

/** Следующий шаг курса на «Сегодня»: урок программы идёт первым, повторение карточек — после. */
export function CourseNext() {
  const next = useLiveQuery(() => nextCourseLesson(), []);
  if (!next) return null;
  const { module, lesson } = next;
  return (
    <Link
      to={`/course/${module.id}/${lesson.id}`}
      className="mb-3 block rounded-[var(--radius-card)] no-underline"
      data-testid="course-next"
    >
      <Card className="bg-soft ring-0 transition-colors hover:bg-[color-mix(in_srgb,var(--soft),var(--primary)_6%)]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="grid min-w-0 flex-1 gap-1">
              <CardDescription className="text-accent-foreground">
                Модуль {String(module.number).padStart(2, "0")} · <span lang="el">{module.title}</span>
              </CardDescription>
              <CardTitle className="font-serif text-2xl font-bold [overflow-wrap:anywhere]">{lesson.title}</CardTitle>
              <CardDescription className="text-foreground/75">
                {lesson.kind === "test" ? "Контрольная · " : ""}
                {lesson.installed
                  ? `заданий выполнено ${lesson.tally.done} из ${lesson.tally.total}`
                  : "урок скачается при открытии"}
              </CardDescription>
            </div>
            <ChevronRight className="shrink-0 text-accent-foreground" />
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
