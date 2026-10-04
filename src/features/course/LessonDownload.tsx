import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Navigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Screen } from "../../app/Screen";
import { installLesson, installPhase, subscribeInstall } from "../../content/client";
import { db } from "../../storage/db";
import ui from "../../shared/ui.module.css";

/** Урок открыт раньше, чем скачался его пакет: ставится сразу, не дожидаясь фоновой очереди курса. */
export function LessonDownload({ lessonId, moduleId }: { lessonId: string; moduleId: string }) {
  const state = useLiveQuery(async () => {
    const [entry, pack] = await Promise.all([db.catalog.get(lessonId), db.packages.get(lessonId)]);
    return { missing: !!entry && !pack, gone: pack ? !(pack.module && pack.blocks) : !entry };
  }, [lessonId]);
  const phase = useSyncExternalStore(subscribeInstall, () => installPhase(lessonId));
  const [attempt, setAttempt] = useState(0);
  const missing = !!state?.missing;
  useEffect(() => {
    if (missing) installLesson(lessonId).catch(() => undefined);
  }, [missing, lessonId, attempt]);
  if (state === undefined) return <Screen back="Урок" />;
  // Скачанный пакет урока курса экран урока подхватит сам; уходим, только если открывать нечего.
  if (state.gone) return <Navigate to={`/course/${moduleId}`} replace />;
  return (
    <Screen back="Урок">
      {phase.phase === "error" ? (
        <div className="mt-6">
          <p className={ui.error} role="alert">
            {phase.message}
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
