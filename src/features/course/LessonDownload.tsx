import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Screen } from "../../app/Screen";
import { installLesson, toContentError } from "../../content/client";
import { courses } from "../../storage/courses";
import { db } from "../../storage/db";
import { CourseStart } from "../today/FirstRun";
import ui from "../../shared/ui.module.css";

/** Урок открыт раньше, чем скачался его пакет: ставится сразу, не дожидаясь фоновой очереди курса. */
export function LessonDownload({ lessonId, moduleId }: { lessonId: string; moduleId: string }) {
  const state = useLiveQuery(async () => {
    const [entry, pack, list] = await Promise.all([db.catalog.get(lessonId), db.packages.get(lessonId), courses()]);
    const started = !entry || list.some((course) => course.id === entry.courseId && course.started);
    return {
      missing: !!entry && !pack && started,
      gone: pack ? !(pack.module && pack.blocks) : !entry,
      courseId: started ? undefined : entry?.courseId,
    };
  }, [lessonId]);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ lessonId: string; attempt: number; message: string }>();
  const missing = !!state?.missing;
  useEffect(() => {
    if (!missing) return;
    // Результат прежней попытки (другой урок, повтор, двойной запуск эффекта) экран не показывает.
    let current = true;
    setFailure(undefined);
    installLesson(lessonId).catch((error) => {
      if (current) setFailure({ lessonId, attempt, message: toContentError(error).message });
    });
    return () => {
      current = false;
    };
  }, [missing, lessonId, attempt]);
  if (state === undefined) return <Screen back="Урок" />;
  // Скачанный пакет урока курса экран урока подхватит сам; уходим, только если открывать нечего.
  if (state.gone) return <Navigate to={`/course/${moduleId}`} replace />;
  // Курс начинают только кнопкой: адрес урока, как и адрес модуля, не ставит уроки неначатого курса.
  if (state.courseId)
    return (
      <Screen back="Урок">
        <CourseStart courseId={state.courseId} />
      </Screen>
    );
  return (
    <Screen back="Урок">
      {failure?.lessonId === lessonId && failure.attempt === attempt ? (
        <div className="mt-6">
          <p className={ui.error} role="alert">
            {failure.message}
          </p>
          <Button size="md" variant="quiet" onClick={() => setAttempt((count) => count + 1)}>
            <RefreshCw data-icon="inline-start" />
            Повторить
          </Button>
        </div>
      ) : (
        <p className={ui.hint} role="status">
          Урок скачивается…
        </p>
      )}
    </Screen>
  );
}
