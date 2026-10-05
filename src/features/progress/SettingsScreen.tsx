import { useEffect, useRef, useState } from "react";
import { Screen } from "../../app/Screen";
import { useHapticsSetting } from "../../platform/haptics";
import { usePlatform } from "../../platform/platform";
import { useSettings } from "../../shared/store";
import { saveSettings } from "../../storage/ops";

export function SettingsScreen() {
  const { settings, ready } = useSettings();
  // Переключатель отвечает сразу, не дожидаясь живого запроса; значение из базы догоняет через эффект ниже.
  const [reports, setReports] = useState(true);
  const [reportsStatus, setReportsStatus] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const platform = usePlatform();
  const [haptics, setHaptics] = useHapticsSetting();
  // Значения из базы подставляются один раз: иначе ответ живого запроса перебивал бы только что нажатый переключатель.
  const filled = useRef(false);
  useEffect(() => {
    if (!ready || filled.current) return;
    filled.current = true;
    setReports(settings.errorReports);
    setAutoSpeak(settings.autoSpeak);
  }, [ready, settings]);
  return (
    <Screen back="Настройки">
      <section data-testid="auto-speak-settings">
        <h2>Озвучка</h2>
        <label
          className="flex items-center justify-between gap-3"
          style={{ color: "inherit", fontSize: 16, margin: 0 }}
        >
          <span>
            Озвучивать автоматически
            <br />
            <span className="text-sm text-muted-foreground">
              Карточка знакомства и задание «Что прозвучало?» звучат сами при открытии. Выключите, если занимаетесь там,
              где нужна тишина: кнопка озвучки работает в любом случае.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Озвучивать автоматически"
            checked={autoSpeak}
            onChange={(event) => {
              const enabled = event.target.checked;
              setAutoSpeak(enabled);
              void saveSettings({ ...settings, autoSpeak: enabled });
            }}
            style={{ width: 22, height: 22, minHeight: 0 }}
          />
        </label>
      </section>
      <section className="mt-6" data-testid="error-reports-settings">
        <h2>Отчёты об ошибках</h2>
        <label
          className="flex items-center justify-between gap-3"
          style={{ color: "inherit", fontSize: 16, margin: 0 }}
        >
          <span>
            Отправлять отчёты об ошибках
            <br />
            <span className="text-sm text-muted-foreground">
              При сбое приложение отправляет тип ошибки, стек и версию — без слов, ответов и данных Telegram. Что именно
              уходит, описано на экране «Копия данных». Действует сразу.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Отправлять отчёты об ошибках"
            checked={reports}
            onChange={(event) => {
              const enabled = event.target.checked;
              setReports(enabled);
              setReportsStatus("");
              saveSettings({ ...settings, errorReports: enabled }).then(
                () => setReportsStatus(enabled ? "Отчёты включены." : "Отчёты выключены, накопленная очередь удалена."),
                () => setReportsStatus("Не удалось сохранить настройку."),
              );
            }}
            style={{ width: 22, height: 22, minHeight: 0 }}
          />
        </label>
        {reportsStatus && (
          <p className="mt-2 text-sm text-(--ok)" role="status" data-testid="error-reports-status">
            {reportsStatus}
          </p>
        )}
      </section>
      {platform.kind === "telegram" && (
        <section className="mt-6" data-testid="telegram-settings">
          <h2>Telegram</h2>
          <label
            className="flex items-center justify-between gap-3"
            style={{ color: "inherit", fontSize: 16, margin: 0 }}
          >
            <span>
              Тактильный отклик результата
              <br />
              <span className="text-sm text-muted-foreground">
                Лёгкая вибрация после сохранённого ответа: успех, почти правильно, ошибка. Настройка хранится на этом
                устройстве.{platform.capabilities.haptics ? "" : " В этом клиенте отклик недоступен."}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Тактильный отклик результата"
              checked={haptics && platform.capabilities.haptics}
              disabled={!platform.capabilities.haptics}
              onChange={(event) => setHaptics(event.target.checked)}
              style={{ width: 22, height: 22, minHeight: 0 }}
            />
          </label>
        </section>
      )}
    </Screen>
  );
}
