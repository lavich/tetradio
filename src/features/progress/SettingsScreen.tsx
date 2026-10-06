import { useEffect, useRef, useState, type ReactNode } from "react";
import { Screen } from "../../app/Screen";
import { BackupSection, REPORT_BOUNDARIES } from "../backup/BackupSection";
import { useHapticsSetting } from "../../platform/haptics";
import { launchContext } from "../../platform/launch";
import { useLaunchMode, usePlatform } from "../../platform/platform";
import { CARDS, withCount, WORDS } from "../../shared/format";
import { megabytes, useOfflineStatus } from "../../shared/offline";
import { useCounts, useSettings } from "../../shared/store";
import { currentProfile } from "../../storage/profile";
import { updateSettings } from "../../storage/ops";
import { useSyncStatus } from "../../sync";
import { SyncLine } from "./SyncLine";
import css from "./settings.module.css";

export function SettingsScreen() {
  const { settings, ready } = useSettings();
  // Переключатель отвечает сразу, не дожидаясь живого запроса; значение из базы догоняет через эффект ниже.
  const [reports, setReports] = useState(true);
  const [reportsStatus, setReportsStatus] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const platform = usePlatform();
  const [haptics, setHaptics] = useHapticsSetting();
  // Значение из базы подставляется, пока переключатель не трогали: иначе чтение базы перебило бы раннее нажатие.
  const touched = useRef(new Set<"reports" | "autoSpeak">());
  useEffect(() => {
    if (!ready) return;
    if (!touched.current.has("reports")) setReports(settings.errorReports);
    if (!touched.current.has("autoSpeak")) setAutoSpeak(settings.autoSpeak);
  }, [ready, settings]);
  return (
    <Screen back="Настройки и данные">
      <section aria-labelledby="lessons" className={css.section}>
        <h2 id="lessons" className={css.heading}>
          Занятия
        </h2>
        <Toggle
          testId="auto-speak-settings"
          label="Озвучивать автоматически"
          note="Карточка знакомства и «Что прозвучало?» звучат сами при открытии. Кнопка озвучки работает всегда."
          checked={autoSpeak}
          onChange={(enabled) => {
            touched.current.add("autoSpeak");
            setAutoSpeak(enabled);
            void updateSettings({ autoSpeak: enabled });
          }}
        />
        {platform.kind === "telegram" && (
          <Toggle
            testId="telegram-settings"
            label="Тактильный отклик результата"
            note={`Лёгкая вибрация после ответа, только на этом устройстве.${
              platform.capabilities.haptics ? "" : " В этом клиенте недоступна."
            }`}
            checked={haptics && platform.capabilities.haptics}
            disabled={!platform.capabilities.haptics}
            onChange={setHaptics}
          />
        )}
      </section>

      <Saving />
      <BackupSection />

      <section aria-labelledby="reports" className={css.section}>
        <h2 id="reports" className={css.heading}>
          Отчёты об ошибках
        </h2>
        <Toggle
          testId="error-reports-settings"
          label="Отправлять отчёты об ошибках"
          note="При сбое уходят тип ошибки и версия приложения, без слов, ответов и данных Telegram."
          checked={reports}
          onChange={(enabled) => {
            touched.current.add("reports");
            setReports(enabled);
            setReportsStatus("");
            updateSettings({ errorReports: enabled }).then(
              () => setReportsStatus(enabled ? "Отчёты включены." : "Отчёты выключены, накопленная очередь удалена."),
              () => setReportsStatus("Не удалось сохранить настройку."),
            );
          }}
        />
        {reportsStatus && (
          <p className={css.ok} role="status" data-testid="error-reports-status">
            {reportsStatus}
          </p>
        )}
        <details className={css.details}>
          <summary>Что именно отправляется</summary>
          <p className={css.note} data-testid="error-reports-boundaries">
            {REPORT_BOUNDARIES}
          </p>
        </details>
      </section>

      <About />
    </Screen>
  );
}

function Toggle({
  testId,
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  testId: string;
  label: string;
  note: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={css.toggle} data-testid={testId}>
      <span className={css.toggleText}>
        <span className={css.toggleLabel}>{label}</span>
        <span className={css.note}>{note}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className={css.switch}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function Saving() {
  const profile = currentProfile();
  const status = useSyncStatus();
  const telegram = profile.kind === "telegram";
  return (
    <section aria-labelledby="saving" className={css.section}>
      <h2 id="saving" className={css.heading}>
        Сохранение
      </h2>
      <div data-testid="storage-scope">
        <p className={css.toggleLabel}>{profile.label}</p>
        <p className={css.note} data-testid="sync-boundaries">
          {telegram
            ? "Между вашими устройствами в этом боте синхронизируются пройденные уроки и задания, повторения карточек и настройки. История ответов и незаконченное занятие переносятся только полной копией. Другие аккаунты Telegram на этом устройстве — отдельные профили."
            : `Сборка разработки вне Telegram: тестовый пользователь ${profile.userId}, данные только в этом браузере, облачной синхронизации нет.`}
        </p>
      </div>
      {telegram && <SyncLine />}
      {status.keys && status.keys.used > status.keys.max * 0.8 && (
        <p className={css.note}>Облако заполнено на {Math.round((status.keys.used / status.keys.max) * 100)} %.</p>
      )}
    </section>
  );
}

function About() {
  const offline = useOfflineStatus();
  const counts = useCounts();
  const profile = currentProfile();
  const telegram = profile.kind === "telegram";
  const platform = usePlatform();
  const launch = launchContext();
  const mode = useLaunchMode();
  const MODES = { compact: "компактный", fullsize: "полноразмерный", fullscreen: "во весь экран" };
  return (
    <details className={css.about}>
      <summary>Об устройстве и приложении</summary>
      <p className={css.note}>
        {offline.checking
          ? "Проверяем офлайн-режим…"
          : offline.ready
            ? telegram
              ? "Открытое приложение работает со скачанными уроками без сети. Запуск без сети зависит от клиента Telegram."
              : "Приложение и скачанные уроки открываются без сети."
            : offline.unsupported
              ? "Офлайн-кеш недоступен в этом клиенте."
              : "Офлайн-пакет ещё загружается."}
        {offline.quota > 0 && ` Занято ${megabytes(offline.usage)} из ${megabytes(offline.quota)}.`}
        {offline.persisted ? "" : " Клиент может очистить данные — сохраняйте полную копию."}
      </p>
      {offline.problem && <p className={css.error}>{offline.problem}</p>}
      <p className={css.note}>
        На устройстве:{" "}
        {counts && counts.cards > counts.words ? withCount(counts.cards, CARDS) : withCount(counts?.words ?? 0, WORDS)}{" "}
        и {withCount(counts?.answers ?? 0, ["ответ", "ответа", "ответов"])}.
      </p>
      {telegram && (
        <p className={css.note} data-testid="launch-mode">
          Telegram {launch.platform ?? "?"} {launch.version ?? ""} · режим:{" "}
          {mode ? MODES[mode] : platform.kind === "telegram" ? "неизвестен" : "интеграция не загружена"}
        </p>
      )}
      <p className={css.note} data-testid="credits">
        Картинки слов — Microsoft Fluent Emoji (лицензия MIT, © Microsoft Corporation). Голоса диалогов — Google Cloud
        Text-to-Speech, остальная озвучка — синтез речи устройства.
      </p>
    </details>
  );
}
