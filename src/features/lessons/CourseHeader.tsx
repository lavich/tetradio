import { GraduationCap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCoursePhase } from "../../shared/store";
import { LESSONS_COUNT, withCount } from "../../shared/format";
import type { CourseGroup } from "./courses";
import ui from "../../shared/ui.module.css";

/** Заголовок группы: что за курс, сколько в нём уже стоит и что с ним можно сделать. */
export function CourseHeader({ group, onLearn }: { group: CourseGroup; onLearn: () => void }) {
  const phase = useCoursePhase(group.origin === "content" ? group.id : undefined);
  const total = group.lessons.length + group.available.length;
  return (
    <>
      <h2 className="mb-0.5">{group.title}</h2>
      <p className={ui.note}>
        {withCount(total, LESSONS_COUNT)}
        {group.lessons.length && group.lessons.length < total ? ` · ${group.lessons.length} на устройстве` : ""}
        {group.source ? ` · ${group.source}` : ""}
      </p>
      {group.origin === "content" && !group.subscribed && group.available.length > 0 && (
        <Button size="md" variant="soft" className="mb-2.5" disabled={phase.phase === "loading"} onClick={onLearn}>
          <GraduationCap data-icon="inline-start" />
          {phase.phase === "loading" ? "Загружаем курс…" : "Учить курс"}
        </Button>
      )}
      {phase.phase === "error" && (
        <div className="mb-2.5">
          <p className={ui.error} data-testid="course-error">
            {phase.message}
          </p>
          <Button size="md" variant="quiet" onClick={onLearn}>
            <RefreshCw data-icon="inline-start" />
            Повторить
          </Button>
        </div>
      )}
    </>
  );
}
