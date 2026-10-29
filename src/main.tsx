import "@fontsource-variable/literata/wght.css";
import "@fontsource-variable/literata/wght-italic.css";
import "./styles.css";
import { StrictMode } from "react";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { appRoot } from "./app/root";
import { erasePhase } from "./storage/erase-marker";
import { App } from "./app/App";
import { autoUpdate, updateReady } from "./app/auto-update";
import { afterStartup, afterStartupOrNeeded, loadSync } from "./app/deferred";
import { CrashScreen } from "./app/CrashScreen";
import { LaunchGate, type LaunchStop } from "./app/LaunchGate";
import { deferredLoad, launchSync, syncOnceOpened } from "./app/launch-sync";
import { Recovery } from "./app/Recovery";
import { installLesson, refreshCatalog, syncCourses } from "./content/client";
import { forgetLaunch } from "./platform/launch";
import { dropServiceWorker, wantsServiceWorker } from "./platform/service-worker";
import { initPlatform, telegramBridge } from "./platform/platform";
import { installEarlyHandlers, reportError, setReportingEnabled } from "./reporting/reporting";
import { bindReportingToSettings } from "./reporting/settings";
import { db, ensureDefaults } from "./storage/db";
import { adoptKnownForeign } from "./storage/foreign";
import { dropIgnoredItems } from "./storage/ops";
import { launchProfile, MOCK_USER, type Profile } from "./storage/profile";

// Ранние обработчики ошибок ставятся до всего остального: отказы запуска копятся до загрузки SDK отчётов.
installEarlyHandlers();
// Только в сборке с моком Telegram: e2e ставят отдельные уроки фикстуры, экрана урока вне курса нет.
if (MOCK_USER !== null) Object.assign(window, { __installLesson: installLesson });
// WebView без service worker не должен обрушить запуск: регистрация обёрнута, обновления просто недоступны.
function setupServiceWorker(wanted: boolean) {
  try {
    if (!("serviceWorker" in navigator)) return;
    void dropServiceWorker({
      scope: new URL(import.meta.env.BASE_URL, location.origin).href,
      container: navigator.serviceWorker,
      caches: typeof caches === "undefined" ? undefined : caches,
    }).catch((error) => console.warn("Service worker не снят", error));
    if (!wanted) return;
    if (import.meta.env.DEV) autoUpdate.unsupported();
    // Регистрация не нужна первому кадру: workbox-window грузится после запуска, а не вместе с экраном.
    afterStartup(() => {
      try {
        const update = registerSW({
          onNeedRefresh() {
            if (autoUpdate.needRefresh()) return;
            updateReady.value = true;
            window.dispatchEvent(new CustomEvent("tetradio:update"));
          },
          onRegisteredSW(_url, registration) {
            if (registration) autoUpdate.registered(registration);
            else autoUpdate.registerFailed();
          },
          onRegisterError(error) {
            autoUpdate.registerFailed();
            console.warn("Service worker недоступен", error);
            reportError(error, { category: "service-worker" });
          },
        });
        updateReady.apply = () => update(true);
      } catch (error) {
        autoUpdate.registerFailed();
        console.warn("Service worker недоступен", error);
      }
    });
  } catch (error) {
    console.warn("Service worker недоступен", error);
  }
}

const root = appRoot();
let stopped = false;
let cancelSyncLoad = () => {};
const stop = (reason: Exclude<LaunchStop, "outside-telegram">) => {
  stopped = true;
  cancelSyncLoad();
  db.close({ disableAutoOpen: true });
  root.render(
    <StrictMode>
      <LaunchGate reason={reason} />
    </StrictMode>,
  );
};
const launch = launchProfile();
setupServiceWorker(wantsServiceWorker(launch));
if (launch.kind === "blocked") {
  if (launch.reason === "outside-telegram") location.replace(import.meta.env.BASE_URL);
  else {
    stop(launch.reason);
    // Внутри Telegram bridge всё равно нужен: тема клиента и снятие экрана загрузки (`ready`).
    void initPlatform();
  }
} else start(launch);

function start(profile: Profile) {
  const erasing = erasePhase(db.name);
  if (erasing) {
    void Promise.all([import("./storage/erase"), import("./app/erase-deps")]).then(
      ([erase, deps]) => erase.resumeErase(erasing, deps.startupEraseDeps()),
      () => root.render(<p className="p-6">Не удалось завершить удаление данных. Перезапустите приложение.</p>),
    );
    return;
  }
  // Настройка отчётов читается из открытой базы. Если база не открылась, настройку прочитать нельзя —
  // отчёт об этом отказе уходит по умолчанию; это единственный случай без проверки настройки.
  // Без базы приложение работать не может: вместо пустой страницы показывается понятное сообщение с перезапуском.
  const opened = db.open().then(
    () => {
      bindReportingToSettings();
    },
    (error) => {
      // Запуск уже остановлен (владелец опровергнут): закрытие базы прервало открытие, это не сбой хранилища.
      if (stopped) throw error;
      const reportId = reportError(error, { category: "storage" });
      setReportingEnabled(true);
      root.render(
        <StrictMode>
          <CrashScreen
            testId="storage-failed"
            title="Не удалось открыть данные"
            description="Хранилище браузера сейчас недоступно. Ваши слова и прогресс не потеряны: перезапуск обычно помогает. Если нет — проверьте свободное место или режим приватного просмотра."
            error={error}
            reportId={reportId}
          />
        </StrictMode>,
      );
      throw error;
    },
  );
  const database = opened
    .then(() => ensureDefaults())
    .then(() => adoptKnownForeign(db))
    .then(() => dropIgnoredItems(db).catch((error) => reportError(error, { category: "storage" })))
    .catch((error) => console.error("Не удалось открыть локальную базу", error));
  // Подписанные курсы догружаются следом за каталогом: новый урок появляется сам, медиа остаётся по запросу.
  refreshCatalog()
    .then(() => syncCourses())
    .catch(() => undefined);
  // Чанк sync берётся после запуска; проверка владельца его не ждёт.
  const syncModule = deferredLoad(afterStartupOrNeeded, loadSync);
  cancelSyncLoad = syncModule.cancel;
  const connect = launchSync({
    profile,
    stopped: () => stopped,
    onMismatch: () => {
      forgetLaunch();
      stop("owner-mismatch");
    },
    connectSync: syncOnceOpened(
      opened,
      Promise.all([database, syncModule.promise]).then(([, { connectSync }]) => connectSync),
    ),
  });
  // По тайм-ауту — без облака; поздний bridge сверяет владельца и подключает CloudStorage.
  void initPlatform(undefined, (app) => void connect(app)).then(() => connect(telegramBridge()));
  root.render(
    <StrictMode>
      <BrowserRouter basename={`${import.meta.env.BASE_URL}app`}>
        <Recovery>
          <App />
        </Recovery>
      </BrowserRouter>
    </StrictMode>,
  );
}
