import { lazy, Suspense, useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Nav } from "./Nav";
import { useGoBack, useStartRoute } from "./navigation";
import { SyncConflictDialog } from "./TelegramNotices";
import { updateReady } from "../main";
import { useBackHandler, useEnvironment } from "../platform/platform";
import { useNow } from "../shared/clock";
import { useSettings } from "../shared/store";
import { settleLessons } from "../storage/ops";
import { useSettleWatch } from "./settle-watch";
import { loadScreen } from "./stale-build";
// «Сегодня» открывается первым и в браузере, и в Mini App, поэтому грузится сразу: иначе первый кадр пустой.
import { TodayScreen } from "../features/today/TodayScreen";
import ui from "../shared/ui.module.css";

const named = <K extends string>(key: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  lazy(() => loadScreen(load).then((module) => ({ default: module[key] })));
const LessonsScreen = named("LessonsScreen", () => import("../features/lessons/LessonsScreen"));
const LessonScreen = named("LessonScreen", () => import("../features/lessons/LessonScreen"));
const CourseScreen = named("CourseScreen", () => import("../features/course/screens"));
const ModuleScreen = named("ModuleScreen", () => import("../features/course/screens"));
const CourseLessonScreen = named("CourseLessonScreen", () => import("../features/course/screens"));
const WordsScreen = named("WordsScreen", () => import("../features/words/WordsScreen"));
const WordScreen = named("WordScreen", () => import("../features/words/WordScreen"));
const SharedWordScreen = named("SharedWordScreen", () => import("../features/words/SharedWordScreen"));
const WordExerciseScreen = named("WordExerciseScreen", () => import("../features/words/WordExerciseScreen"));
const SessionScreen = named("SessionScreen", () => import("../features/learning/SessionScreen"));
const ResultScreen = named("ResultScreen", () => import("../features/learning/ResultScreen"));
const MoreScreen = named("MoreScreen", () => import("../features/more/MoreScreen"));
const StatsScreen = named("StatsScreen", () => import("../features/progress/StatsScreen"));
const SettingsScreen = named("SettingsScreen", () => import("../features/more/SettingsScreen"));
const BackupScreen = named("BackupScreen", () => import("../features/backup/BackupScreen"));

export function App() {
  const { pathname } = useLocation();
  const immersive = pathname.startsWith("/session") || /^\/words\/[^/]+\/exercise\//.test(pathname);
  // В уроке курса облачко снизу — листание страниц; выход из урока — «Назад».
  const lesson = /^\/course\/[^/]+\/[^/]+/.test(pathname);
  const { settings } = useSettings();
  useEnvironment();
  useStartRoute();
  // Резервный возврат Telegram: на «Сегодня» кнопка скрыта, на остальных экранах без своего обработчика ведёт назад или на главный.
  const goBack = useGoBack();
  useBackHandler(pathname === "/" ? null : goBack, 0);
  useSettleWatch(useNow(), settings.timezone, () => {
    settleLessons(new Date()).catch((error) => console.error("Не удалось закрепить прошедшие уроки", error));
  });
  useEffect(() => {
    // Обновление предлагаем между занятиями, чтобы не прервать ответ.
    const notice = () => {
      if (immersive) return;
      toast("Есть обновление приложения", {
        duration: Infinity,
        action: { label: "Обновить", onClick: () => updateReady.apply() },
      });
    };
    if (updateReady.value) notice();
    window.addEventListener("tetradio:update", notice);
    return () => window.removeEventListener("tetradio:update", notice);
  }, [immersive]);
  return (
    <div className={ui.app}>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/course" element={<CourseScreen />} />
          <Route path="/course/:moduleId" element={<ModuleScreen />} />
          <Route path="/course/:moduleId/:lessonId" element={<CourseLessonScreen />} />
          <Route path="/lessons" element={<LessonsScreen />} />
          <Route path="/lessons/:id" element={<LessonScreen />} />
          <Route path="/words" element={<WordsScreen />} />
          <Route path="/words/:id" element={<WordScreen />} />
          <Route path="/words/:id/exercise/:type" element={<WordExerciseScreen />} />
          <Route path="/share/word/:id" element={<SharedWordScreen />} />
          <Route path="/session" element={<SessionScreen />} />
          <Route path="/session/result/:id" element={<ResultScreen />} />
          <Route path="/more" element={<MoreScreen />} />
          <Route path="/more/stats" element={<StatsScreen />} />
          <Route path="/more/settings" element={<SettingsScreen />} />
          <Route path="/more/backup" element={<BackupScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster position="bottom-center" offset={88} />
      {!immersive && !lesson && <Nav />}
      {!immersive && <SyncConflictDialog />}
    </div>
  );
}
