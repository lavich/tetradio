import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Nav } from "./Nav";
import { useGoBack, useStartRoute } from "./navigation";
import { updateReady } from "../main";
import { useBackHandler, useEnvironment } from "../platform/platform";
import { afterStartup, loadConflictDialog, syncNeededNow, useFirstInteraction, useSyncConflictSeen } from "./deferred";
import { loadScreen } from "./stale-build";
import { useScrollMemory } from "./scroll";
// «Сегодня» открывается первым и в браузере, и в Mini App, поэтому грузится сразу: иначе первый кадр пустой.
import { TodayScreen } from "../features/today/TodayScreen";
import ui from "../shared/ui.module.css";

const named = <K extends string>(key: K, load: () => Promise<Record<K, React.ComponentType>>) =>
  lazy(() => loadScreen(load).then((module) => ({ default: module[key] })));
const CourseScreen = named("CourseScreen", () => import("../features/course/ShelfScreen"));
const ModuleScreen = named("ModuleScreen", () => import("../features/course/ModuleScreen"));
const CourseLessonScreen = named("CourseLessonScreen", () => import("../features/course/LessonScreen"));
const ReadingScreen = named("ReadingScreen", () => import("../features/course/ReadingScreen"));
const ReadingsScreen = named("ReadingsScreen", () => import("../features/course/ReadingsScreen"));
const WordsScreen = named("WordsScreen", () => import("../features/words/WordsScreen"));
const WordScreen = named("WordScreen", () => import("../features/words/WordScreen"));
const PhraseScreen = named("PhraseScreen", () => import("../features/words/WordScreen"));
const SharedWordScreen = named("SharedWordScreen", () => import("../features/words/SharedWordScreen"));
const WordExerciseScreen = named("WordExerciseScreen", () => import("../features/words/WordExerciseScreen"));
const SessionScreen = named("SessionScreen", () => import("../features/learning/SessionScreen"));
const ResultScreen = named("ResultScreen", () => import("../features/learning/ResultScreen"));
const ProgressScreen = named("ProgressScreen", () => import("../features/progress/ProgressScreen"));
const SettingsScreen = named("SettingsScreen", () => import("../features/progress/SettingsScreen"));
// Уведомления и диалог конфликта не нужны первому кадру: без чанка они просто не показываются.
const optional = <P extends object>(load: () => Promise<React.ComponentType<P>>) =>
  lazy(() =>
    load().then(
      (component) => ({ default: component }),
      (error: unknown) => {
        console.warn("Необязательная часть интерфейса не загрузилась", error);
        return { default: (() => null) as React.ComponentType<P> };
      },
    ),
  );
const Toaster = optional(() => import("@/components/ui/sonner").then((module) => module.Toaster));
const SyncConflictDialog = optional(() => loadConflictDialog().then((module) => module.SyncConflictDialog));

/** Прежние адреса раздела «Ещё» остаются в закладках и истории Telegram. */
function MoreRedirect() {
  const { "*": rest } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`/progress${rest ? `/${rest}` : ""}${search}${hash}`} replace />;
}

export function App() {
  const { pathname } = useLocation();
  const immersive = pathname.startsWith("/session") || /^\/words\/[^/]+\/exercise\//.test(pathname);
  // В уроке курса облачко снизу — листание страниц; выход из урока — «Назад».
  const lesson = /^\/course\/[^/]+\/[^/]+/.test(pathname);
  const root = useRef<HTMLDivElement>(null);
  useEnvironment();
  useStartRoute();
  useScrollMemory(root);
  // Резервный возврат Telegram: на «Сегодня» кнопка скрыта, на остальных экранах без своего обработчика ведёт назад или на главный.
  const goBack = useGoBack();
  useBackHandler(pathname === "/" ? null : goBack, 0);
  const interacted = useFirstInteraction();
  const [updateNotice, setUpdateNotice] = useState(false);
  const conflict = useSyncConflictSeen();
  useEffect(() => {
    if (pathname.startsWith("/progress")) syncNeededNow();
  }, [pathname]);
  useEffect(() => afterStartup(() => void loadConflictDialog().catch(() => undefined)), []);
  useEffect(() => {
    // Обновление предлагаем между занятиями, чтобы не прервать ответ.
    const notice = () => {
      if (immersive) return;
      setUpdateNotice(true);
      import("sonner")
        .then(({ toast }) =>
          toast("Есть обновление приложения", {
            duration: Infinity,
            action: { label: "Обновить", onClick: () => updateReady.apply() },
          }),
        )
        .catch((error) => console.warn("Не удалось показать обновление", error));
    };
    if (updateReady.value) notice();
    window.addEventListener("tetradio:update", notice);
    return () => window.removeEventListener("tetradio:update", notice);
  }, [immersive]);
  return (
    <div ref={root} className={ui.app}>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/course" element={<CourseScreen />} />
          <Route path="/course/:moduleId" element={<ModuleScreen />} />
          <Route path="/course/:moduleId/:lessonId" element={<CourseLessonScreen />} />
          <Route path="/course/:moduleId/read/:readingId" element={<ReadingScreen />} />
          <Route path="/lessons/*" element={<Navigate to="/course" replace />} />
          <Route path="/reading" element={<ReadingsScreen />} />
          <Route path="/words" element={<WordsScreen />} />
          <Route path="/words/:id" element={<WordScreen />} />
          <Route path="/words/phrase/:id" element={<PhraseScreen />} />
          <Route path="/words/:id/exercise/:type" element={<WordExerciseScreen />} />
          <Route path="/share/word/:id" element={<SharedWordScreen />} />
          <Route path="/session" element={<SessionScreen />} />
          <Route path="/session/result/:id" element={<ResultScreen />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/progress/stats" element={<Navigate to="/progress" replace />} />
          <Route path="/progress/settings" element={<SettingsScreen />} />
          <Route path="/progress/backup" element={<Navigate to="/progress/settings" replace />} />
          <Route path="/more/*" element={<MoreRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      {(interacted || updateNotice) && (
        <Suspense fallback={null}>
          <Toaster position="bottom-center" offset={88} />
        </Suspense>
      )}
      {!immersive && !lesson && <Nav />}
      <Suspense fallback={null}>{!immersive && conflict && <SyncConflictDialog />}</Suspense>
    </div>
  );
}
