import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app/App";
import { CrashScreen } from "./app/CrashScreen";
import { Recovery } from "./app/Recovery";
import { refreshCatalog, syncCourses } from "./content/client";
import { initPlatform, telegramBridge } from "./platform/platform";
import { installEarlyHandlers, reportError, setReportingEnabled } from "./reporting/reporting";
import { bindReportingToSettings } from "./reporting/settings";
import { db, ensureDefaults } from "./storage/db";
import { settleLessons } from "./storage/ops";
import { connectSync } from "./sync";
import "./styles.css";

// Ранние обработчики ошибок ставятся до всего остального: отказы запуска копятся до загрузки SDK отчётов.
installEarlyHandlers();
export const updateReady = { value: false, apply: () => {} };
// WebView без service worker не должен обрушить запуск: регистрация обёрнута, обновления просто недоступны.
try {
  if ("serviceWorker" in navigator) {
    const update = registerSW({
      onNeedRefresh() {
        updateReady.value = true;
        window.dispatchEvent(new CustomEvent("lexi:update"));
      },
      onRegisterError(error) {
        console.warn("Service worker недоступен", error);
        reportError(error, { category: "service-worker" });
      },
    });
    updateReady.apply = () => update(true);
  }
} catch (error) {
  console.warn("Service worker недоступен", error);
}

const root = createRoot(document.getElementById("root")!);
// Настройка отчётов читается из открытой базы. Если база не открылась, настройку прочитать нельзя —
// отчёт об этом отказе уходит по умолчанию; это единственный случай без проверки настройки.
// Без базы приложение работать не может: вместо пустой страницы показывается понятное сообщение с перезапуском.
const opened = db.open().then(
  () => {
    bindReportingToSettings();
  },
  (error) => {
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
  .then(() => settleLessons(new Date()))
  .catch((error) => console.error("Не удалось открыть локальную базу", error));
// Подписанные курсы догружаются следом за каталогом: новый урок появляется сам, медиа остаётся по запросу.
refreshCatalog()
  .then(() => syncCourses())
  .catch(() => undefined);
// Bridge Telegram загружается параллельно и не задерживает рендер; синхронизация подключается после базы и bridge.
const platform = initPlatform();
Promise.all([database, platform])
  .then(() => connectSync(telegramBridge()))
  .catch((error) => console.warn("Синхронизация не подключена", error));
root.render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Recovery>
        <App />
      </Recovery>
    </BrowserRouter>
  </StrictMode>,
);
